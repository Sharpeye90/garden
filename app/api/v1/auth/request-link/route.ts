import { NextResponse } from "next/server";
import {
  createOpaqueToken,
  invitedEmail,
  normalizeEmail,
  requestFingerprint,
  tokenHash,
} from "@/app/lib/auth";
import {
  emailDeliveryConfigured,
  sendMagicLinkEmail,
} from "@/app/lib/email";
import { ensureSchema, getPool } from "@/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return NextResponse.json({ error: "invalid_email" }, { status: 422 });
  }

  try {
    await ensureSchema();
    await Promise.all([
      getPool().query(
        "DELETE FROM auth_magic_links WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day'",
      ),
      getPool().query("DELETE FROM auth_sessions WHERE expires_at < CURRENT_TIMESTAMP"),
    ]);
    const fingerprint = await requestFingerprint();
    const recent = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM auth_magic_links
       WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '15 minutes'
         AND (email = $1 OR ($2::text IS NOT NULL AND requested_ip_hash = $2))`,
      [email, fingerprint],
    );
    if (Number(recent.rows[0]?.count ?? 0) >= 3) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    if (!emailDeliveryConfigured()) {
      return NextResponse.json({ error: "email_unavailable" }, { status: 503 });
    }

    if (!(await invitedEmail(email))) {
      return NextResponse.json({ status: "sent", expiresIn: 900 }, { status: 202 });
    }

    const token = createOpaqueToken();
    const hash = tokenHash(token);
    await getPool().query(
      `INSERT INTO auth_magic_links
         (token_hash, email, requested_ip_hash, expires_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '15 minutes')`,
      [hash, email, fingerprint],
    );

    const configuredOrigin = process.env.GARDEN_APP_URL?.trim();
    const origin = configuredOrigin || new URL(request.url).origin;
    const magicLink = new URL("/api/v1/auth/verify", origin);
    magicLink.searchParams.set("token", token);

    const delivered = await sendMagicLinkEmail({
      email,
      magicLink: magicLink.toString(),
    });
    if (!delivered) {
      if (
        process.env.NODE_ENV !== "production" &&
        process.env.GARDEN_AUTH_EXPOSE_LINK === "true"
      ) {
        return NextResponse.json(
          { status: "sent", expiresIn: 900, developmentMagicLink: magicLink },
          { status: 202 },
        );
      }
      await getPool().query("DELETE FROM auth_magic_links WHERE token_hash = $1", [hash]);
      console.error("Magic link email provider rejected delivery");
      return NextResponse.json({ status: "sent", expiresIn: 900 }, { status: 202 });
    }

    return NextResponse.json({ status: "sent", expiresIn: 900 }, { status: 202 });
  } catch (error) {
    console.error("Magic link request failed", error);
    return NextResponse.json({ error: "auth_unavailable" }, { status: 503 });
  }
}
