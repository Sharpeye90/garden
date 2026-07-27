import { Pool } from "pg";

const globalDatabase = globalThis as typeof globalThis & {
  gardenPool?: Pool;
  gardenSchemaPromise?: Promise<void>;
};

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  globalDatabase.gardenPool ??= new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 8),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  return globalDatabase.gardenPool;
}

export async function ensureSchema(): Promise<void> {
  globalDatabase.gardenSchemaPromise ??= getPool()
    .query(`
      CREATE TABLE IF NOT EXISTS garden_states (
        user_key TEXT PRIMARY KEY,
        garden_id TEXT NOT NULL DEFAULT 'primary',
        payload JSONB NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key TEXT PRIMARY KEY,
        user_key TEXT NOT NULL,
        result_revision INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idempotency_keys_user_created_idx
        ON idempotency_keys (user_key, created_at DESC);

      CREATE TABLE IF NOT EXISTS assistant_questions (
        id UUID PRIMARY KEY,
        user_key TEXT NOT NULL,
        garden_id TEXT NOT NULL DEFAULT 'primary',
        question TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        response JSONB,
        input_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS assistant_questions_status_created_idx
        ON assistant_questions (status, created_at);
    `)
    .then(() => undefined)
    .catch((error) => {
      globalDatabase.gardenSchemaPromise = undefined;
      throw error;
    });

  return globalDatabase.gardenSchemaPromise;
}
