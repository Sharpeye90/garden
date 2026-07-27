import { NextResponse } from "next/server";
import { currentUserKey } from "@/app/lib/server-auth";
import { ensureSchema, getPool } from "@/db";

export const dynamic = "force-dynamic";

type StatePayload = {
  state?: unknown;
  expectedRevision?: number;
  idempotencyKey?: string;
};

function storageUnavailable(error: unknown) {
  console.error("Garden state storage is unavailable", error);
  return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
}

export async function GET() {
  const userKey = await currentUserKey();
  if (!userKey) return NextResponse.json({ error: "authentication_required" }, { status: 401 });

  try {
    await ensureSchema();
    const result = await getPool().query<{
      payload: unknown;
      revision: number;
      updatedAt: string;
    }>(
      `SELECT payload, revision, updated_at AS "updatedAt"
       FROM garden_states WHERE user_key = $1`,
      [userKey],
    );

    const row = result.rows[0];
    if (!row) return new NextResponse(null, { status: 204 });
    return NextResponse.json({
      state: row.payload,
      revision: row.revision,
      updatedAt: row.updatedAt,
    });
  } catch (error) {
    return storageUnavailable(error);
  }
}

export async function PUT(request: Request) {
  const userKey = await currentUserKey();
  if (!userKey) return NextResponse.json({ error: "authentication_required" }, { status: 401 });

  let body: StatePayload;
  try {
    body = (await request.json()) as StatePayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.state || !body.idempotencyKey || body.idempotencyKey.length > 100) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
  }

  const payload = JSON.stringify(body.state);
  if (payload.length > 1_500_000) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  try {
    await ensureSchema();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const replay = await client.query<{ revision: number }>(
        `SELECT result_revision AS revision
         FROM idempotency_keys WHERE key = $1 AND user_key = $2`,
        [body.idempotencyKey, userKey],
      );
      if (replay.rows[0]) {
        await client.query("COMMIT");
        return NextResponse.json(replay.rows[0]);
      }

      const existing = await client.query<{ revision: number }>(
        "SELECT revision FROM garden_states WHERE user_key = $1 FOR UPDATE",
        [userKey],
      );
      const currentRevision = existing.rows[0]?.revision ?? 0;

      if (
        typeof body.expectedRevision === "number" &&
        body.expectedRevision !== currentRevision
      ) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "revision_conflict", currentRevision },
          { status: 409 },
        );
      }

      const nextRevision = currentRevision + 1;
      await client.query(
        `INSERT INTO garden_states (user_key, garden_id, payload, revision, updated_at)
         VALUES ($1, 'primary', $2::jsonb, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (user_key) DO UPDATE SET
           payload = EXCLUDED.payload,
           revision = EXCLUDED.revision,
           updated_at = CURRENT_TIMESTAMP`,
        [userKey, payload, nextRevision],
      );
      await client.query(
        `INSERT INTO idempotency_keys (key, user_key, result_revision)
         VALUES ($1, $2, $3)`,
        [body.idempotencyKey, userKey, nextRevision],
      );
      await client.query("COMMIT");
      return NextResponse.json({ revision: nextRevision });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return storageUnavailable(error);
  }
}
