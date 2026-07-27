import { NextResponse } from "next/server";
import { currentUserKey } from "@/app/lib/server-auth";
import { ensureSchema, getPool } from "@/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const userKey = await currentUserKey();
  if (!userKey) return NextResponse.json({ error: "authentication_required" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { question?: string } | null;
  const question = body?.question?.trim();
  if (!question || question.length > 1200) {
    return NextResponse.json({ error: "invalid_question" }, { status: 422 });
  }

  try {
    await ensureSchema();
    const id = crypto.randomUUID();
    await getPool().query(
      `INSERT INTO assistant_questions (id, user_key, garden_id, question)
       VALUES ($1, $2, 'primary', $3)`,
      [id, userKey, question],
    );
    return NextResponse.json({ id, status: "queued" }, { status: 202 });
  } catch (error) {
    console.error("Assistant queue is unavailable", error);
    return NextResponse.json({ error: "queue_unavailable" }, { status: 503 });
  }
}
