import { NextResponse } from "next/server";
import {
  createOpaqueToken,
  normalizeEmail,
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  sessionCookieOptions,
  tokenHash,
} from "@/app/lib/auth";
import { ensureSchema, getPool } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token || token.length > 100) return redirectWithStatus(request, "invalid");

  try {
    await ensureSchema();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ email: string }>(
        `UPDATE auth_magic_links
         SET used_at = CURRENT_TIMESTAMP
         WHERE token_hash = $1
           AND used_at IS NULL
           AND expires_at > CURRENT_TIMESTAMP
         RETURNING email`,
        [tokenHash(token)],
      );
      const email = normalizeEmail(result.rows[0]?.email);
      if (!email) {
        await client.query("ROLLBACK");
        return redirectWithStatus(request, "expired");
      }

      const sessionToken = createOpaqueToken();
      await client.query(
        `INSERT INTO auth_sessions (token_hash, user_key, expires_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 day'))`,
        [tokenHash(sessionToken), email, SESSION_TTL_DAYS],
      );
      await client.query("COMMIT");

      const response = redirectWithStatus(request, "success");
      response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Magic link verification failed", error);
    return redirectWithStatus(request, "unavailable");
  }
}

function redirectWithStatus(request: Request, status: string) {
  let target: URL;
  try {
    target = new URL("/", process.env.GARDEN_APP_URL?.trim() || request.url);
  } catch {
    target = new URL("/", request.url);
  }
  target.searchParams.set("auth", status);
  return NextResponse.redirect(target);
}
