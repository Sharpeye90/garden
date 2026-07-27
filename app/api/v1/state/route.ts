import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";

export const dynamic = "force-dynamic";

type StatePayload = {
  state?: unknown;
  expectedRevision?: number;
  idempotencyKey?: string;
};

async function ensureTables(database: D1Database) {
  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS garden_states (
      user_key TEXT PRIMARY KEY,
      garden_id TEXT NOT NULL DEFAULT 'primary',
      payload TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      user_key TEXT NOT NULL,
      result_revision INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
  ]);
}

async function currentUserKey() {
  const user = await getChatGPTUser();
  if (user) return user.email.toLowerCase();
  return process.env.NODE_ENV === "production" ? null : "local-preview";
}

export async function GET() {
  const userKey = await currentUserKey();
  if (!userKey) return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  if (!env.DB) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });

  await ensureTables(env.DB);
  const row = await env.DB.prepare(
    "SELECT payload, revision, updated_at AS updatedAt FROM garden_states WHERE user_key = ?",
  )
    .bind(userKey)
    .first<{ payload: string; revision: number; updatedAt: string }>();

  if (!row) return new NextResponse(null, { status: 204 });
  return NextResponse.json({
    state: JSON.parse(row.payload),
    revision: row.revision,
    updatedAt: row.updatedAt,
  });
}

export async function PUT(request: Request) {
  const userKey = await currentUserKey();
  if (!userKey) return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  if (!env.DB) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });

  let body: StatePayload;
  try {
    body = (await request.json()) as StatePayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.state || !body.idempotencyKey || body.idempotencyKey.length > 100) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
  }

  await ensureTables(env.DB);
  const replay = await env.DB.prepare(
    "SELECT result_revision AS revision FROM idempotency_keys WHERE key = ? AND user_key = ?",
  )
    .bind(body.idempotencyKey, userKey)
    .first<{ revision: number }>();
  if (replay) return NextResponse.json(replay);

  const existing = await env.DB.prepare(
    "SELECT revision FROM garden_states WHERE user_key = ?",
  )
    .bind(userKey)
    .first<{ revision: number }>();

  const currentRevision = existing?.revision ?? 0;
  if (
    typeof body.expectedRevision === "number" &&
    body.expectedRevision !== currentRevision
  ) {
    return NextResponse.json(
      { error: "revision_conflict", currentRevision },
      { status: 409 },
    );
  }

  const nextRevision = currentRevision + 1;
  const payload = JSON.stringify(body.state);
  if (payload.length > 1_500_000) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO garden_states (user_key, garden_id, payload, revision, updated_at)
      VALUES (?, 'primary', ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_key) DO UPDATE SET payload = excluded.payload, revision = excluded.revision, updated_at = CURRENT_TIMESTAMP`)
      .bind(userKey, payload, nextRevision),
    env.DB.prepare(
      "INSERT INTO idempotency_keys (key, user_key, result_revision) VALUES (?, ?, ?)",
    ).bind(body.idempotencyKey, userKey, nextRevision),
  ]);

  return NextResponse.json({ revision: nextRevision });
}
