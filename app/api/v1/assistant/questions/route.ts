import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  const userKey = user?.email.toLowerCase() ?? (process.env.NODE_ENV === "production" ? null : "local-preview");
  if (!userKey) return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  if (!env.DB) return NextResponse.json({ error: "queue_unavailable" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { question?: string } | null;
  const question = body?.question?.trim();
  if (!question || question.length > 1200) {
    return NextResponse.json({ error: "invalid_question" }, { status: 422 });
  }

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS assistant_questions (
    id TEXT PRIMARY KEY,
    user_key TEXT NOT NULL,
    garden_id TEXT NOT NULL,
    question TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    response TEXT,
    input_hash TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  )`).run();

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO assistant_questions (id, user_key, garden_id, question) VALUES (?, ?, 'primary', ?)",
  )
    .bind(id, userKey, question)
    .run();

  return NextResponse.json({ id, status: "queued" }, { status: 202 });
}
