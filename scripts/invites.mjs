#!/usr/bin/env node

import pg from "pg";

const { Client } = pg;

const HELP = `Инвайты «Ритма сада»

Использование:
  npm run invites -- add EMAIL [--note "текст"]
  npm run invites -- remove EMAIL [--logout]
  npm run invites -- list [--all] [--json]
  npm run invites -- check EMAIL [--json]

Команды:
  add       добавить или восстановить приглашение
  remove    запретить новые входы и отозвать неиспользованные ссылки
  list      показать активные приглашения
  check     проверить конкретный email

Флаги:
  --note     короткая заметка о приглашении
  --logout   при удалении также завершить активные сессии
  --all      показать в списке и отозванные приглашения
  --json     вывести результат в JSON
`;

function loadLocalEnvironment() {
  try {
    process.loadEnvFile?.(".env");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 5 || email.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = { all: false, json: false, logout: false, note: null };
  const positional = [];

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--all") options.all = true;
    else if (value === "--json") options.json = true;
    else if (value === "--logout") options.logout = true;
    else if (value === "--note") {
      const note = rest[index + 1];
      if (!note || note.startsWith("--")) throw new Error("После --note нужен текст");
      options.note = note.trim();
      index += 1;
    } else if (value.startsWith("--")) {
      throw new Error(`Неизвестный флаг: ${value}`);
    } else {
      positional.push(value);
    }
  }

  if (options.note && options.note.length > 500) {
    throw new Error("Заметка не должна быть длиннее 500 символов");
  }
  return { command, options, positional };
}

async function ensureInviteSchema(client) {
  await client.query(`
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
  `);
}

function requireEmail(positional) {
  if (positional.length !== 1) throw new Error("Укажите один email");
  const email = normalizeEmail(positional[0]);
  if (!email) throw new Error("Некорректный email");
  return email;
}

function printInvite(invite, json) {
  if (json) {
    console.log(JSON.stringify(invite, null, 2));
    return;
  }
  const status = invite.revokedAt ? "отозван" : "активен";
  console.log(`${invite.email} — ${status}`);
  if (invite.note) console.log(`Заметка: ${invite.note}`);
}

async function addInvite(client, email, options) {
  const result = await client.query(
    `INSERT INTO auth_invites (email, note)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET
       note = COALESCE(EXCLUDED.note, auth_invites.note),
       revoked_at = NULL,
       updated_at = CURRENT_TIMESTAMP
     RETURNING email, note, created_at AS "createdAt", revoked_at AS "revokedAt"`,
    [email, options.note],
  );
  printInvite(result.rows[0], options.json);
}

async function removeInvite(client, email, options) {
  await client.query("BEGIN");
  try {
    const result = await client.query(
      `UPDATE auth_invites
       SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE email = $1 AND revoked_at IS NULL
       RETURNING email, note, created_at AS "createdAt", revoked_at AS "revokedAt"`,
      [email],
    );
    const links = await client.query(
      "DELETE FROM auth_magic_links WHERE email = $1 AND used_at IS NULL",
      [email],
    );
    let sessions = { rowCount: 0 };
    if (options.logout) {
      sessions = await client.query("DELETE FROM auth_sessions WHERE user_key = $1", [
        email,
      ]);
    }
    await client.query("COMMIT");

    const payload = {
      email,
      revoked: Boolean(result.rows[0]),
      revokedMagicLinks: links.rowCount ?? 0,
      closedSessions: sessions.rowCount ?? 0,
    };
    if (options.json) console.log(JSON.stringify(payload, null, 2));
    else if (!payload.revoked) console.log(`${email} уже не имеет активного инвайта`);
    else {
      console.log(`${email} — инвайт отозван`);
      console.log(`Отозвано ссылок: ${payload.revokedMagicLinks}`);
      if (options.logout) console.log(`Закрыто сессий: ${payload.closedSessions}`);
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function listInvites(client, options) {
  const result = await client.query(
    `SELECT email, note, created_at AS "createdAt", revoked_at AS "revokedAt"
     FROM auth_invites
     ${options.all ? "" : "WHERE revoked_at IS NULL"}
     ORDER BY created_at DESC, email ASC`,
  );
  if (options.json) {
    console.log(JSON.stringify(result.rows, null, 2));
    return;
  }
  if (result.rows.length === 0) {
    console.log("Инвайтов пока нет");
    return;
  }
  for (const invite of result.rows) {
    const status = invite.revokedAt ? "отозван" : "активен";
    const note = invite.note ? ` · ${invite.note}` : "";
    console.log(`${invite.email} · ${status}${note}`);
  }
}

async function checkInvite(client, email, options) {
  const result = await client.query(
    `SELECT email, note, created_at AS "createdAt", revoked_at AS "revokedAt"
     FROM auth_invites WHERE email = $1`,
    [email],
  );
  const invite = result.rows[0] ?? null;
  const payload = { email, invited: Boolean(invite && !invite.revokedAt), invite };
  if (options.json) console.log(JSON.stringify(payload, null, 2));
  else console.log(`${email} — ${payload.invited ? "вход разрешён" : "вход не разрешён"}`);
  if (!payload.invited) process.exitCode = 2;
}

async function main() {
  const { command, options, positional } = parseArguments(process.argv.slice(2));
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  if (!new Set(["add", "remove", "list", "check"]).has(command)) {
    throw new Error(`Неизвестная команда: ${command}`);
  }

  loadLocalEnvironment();
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL не задан");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await ensureInviteSchema(client);
    if (command === "add") await addInvite(client, requireEmail(positional), options);
    else if (command === "remove") {
      await removeInvite(client, requireEmail(positional), options);
    } else if (command === "list") {
      if (positional.length > 0) throw new Error("Команда list не принимает email");
      await listInvites(client, options);
    } else if (command === "check") {
      await checkInvite(client, requireEmail(positional), options);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
});
