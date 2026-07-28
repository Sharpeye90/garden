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

      CREATE TABLE IF NOT EXISTS auth_magic_links (
        token_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        requested_ip_hash TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS auth_magic_links_email_created_idx
        ON auth_magic_links (email, created_at DESC);

      CREATE INDEX IF NOT EXISTS auth_magic_links_ip_created_idx
        ON auth_magic_links (requested_ip_hash, created_at DESC);

      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_key TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS auth_sessions_user_expires_idx
        ON auth_sessions (user_key, expires_at DESC);

      CREATE TABLE IF NOT EXISTS auth_invites (
        email TEXT PRIMARY KEY,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS auth_invites_active_created_idx
        ON auth_invites (created_at DESC)
        WHERE revoked_at IS NULL;
    `)
    .then(() => undefined)
    .catch((error) => {
      globalDatabase.gardenSchemaPromise = undefined;
      throw error;
    });

  return globalDatabase.gardenSchemaPromise;
}
