import { createHash, createHmac, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { ensureSchema, getPool } from "@/db";

export const SESSION_COOKIE = "garden_session";
export const SESSION_TTL_DAYS = 30;

export type GardenUser = {
  displayName: string;
  email: string;
  fullName: string | null;
};

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 5 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function getSessionUser(): Promise<GardenUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    await ensureSchema();
    const result = await getPool().query<{ userKey: string }>(
      `UPDATE auth_sessions
       SET last_seen_at = CURRENT_TIMESTAMP
       WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP
       RETURNING user_key AS "userKey"`,
      [tokenHash(token)],
    );
    const email = result.rows[0]?.userKey;
    if (!email) return null;
    return {
      email,
      displayName: displayNameFromEmail(email),
      fullName: null,
    };
  } catch (error) {
    console.error("Garden session lookup failed", error);
    return null;
  }
}

export async function requestFingerprint(): Promise<string | null> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded ?? requestHeaders.get("x-real-ip")?.trim();
  if (!address) return null;
  const secret =
    process.env.SESSION_SECRET?.trim() ??
    process.env.DATABASE_URL?.trim() ??
    "garden-local-rate-limit";
  return createHmac("sha256", secret).update(address).digest("hex");
}

export function invitedEmail(email: string): boolean {
  const configured = process.env.GARDEN_INVITE_EMAILS?.trim();
  if (!configured) return true;
  const invited = new Set(
    configured
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  return invited.has(email);
}

export function displayNameFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? "Садовод";
  const readable = localPart.split(/[._-]/)[0] ?? localPart;
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  };
}
