import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  tokenHash,
} from "@/app/lib/auth";
import { ensureSchema, getPool } from "@/db";

export const dynamic = "force-dynamic";

export async function POST() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  if (token) {
    try {
      await ensureSchema();
      await getPool().query("DELETE FROM auth_sessions WHERE token_hash = $1", [
        tokenHash(token),
      ]);
    } catch (error) {
      console.error("Garden logout cleanup failed", error);
    }
  }

  const response = NextResponse.json({ status: "signed_out" });
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
