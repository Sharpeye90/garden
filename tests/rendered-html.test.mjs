import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("build contains the standalone garden assistant and assets", async () => {
  await Promise.all([
    access(new URL("dist/server/index.js", root)),
    access(new URL("dist/standalone/server.js", root)),
    access(new URL("dist/client/og.png", root)),
    access(new URL("dist/client/icon.png", root)),
  ]);
});

test("product shell replaces every starter marker", async () => {
  const [page, layout, app, css, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/components/GardenApp.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(page, /Ритм сада/);
  assert.match(layout, /lang="ru"/);
  assert.match(app, /Сегодня саду понадобится/);
  assert.match(app, /План участка/);
  assert.match(app, /Календарь цветения/);
  assert.match(css, /\.mobile-nav/);
  assert.doesNotMatch(
    `${page}\n${layout}\n${packageJson}`,
    /codex-preview|Your site is taking shape|react-loading-skeleton/i,
  );
});

test("server contracts cover health, weather, state and assistant queue", async () => {
  const [health, weather, state, assistant] = await Promise.all([
    readFile(new URL("app/api/v1/health/route.ts", root), "utf8"),
    readFile(new URL("app/api/v1/weather/route.ts", root), "utf8"),
    readFile(new URL("app/api/v1/state/route.ts", root), "utf8"),
    readFile(new URL("app/api/v1/assistant/questions/route.ts", root), "utf8"),
  ]);

  assert.match(health, /garden-rhythm/);
  assert.match(health, /database/);
  assert.match(weather, /open-meteo\.com/);
  assert.match(state, /revision_conflict/);
  assert.match(state, /idempotency_keys/);
  assert.match(state, /FOR UPDATE/);
  assert.match(assistant, /status: "queued"/);
});

test("K2 deployment stays private and uses managed PostgreSQL", async () => {
  const [terraform, compose, deploy, dockerfile] = await Promise.all([
    readFile(new URL("infra/k2/terraform/main.tf", root), "utf8"),
    readFile(new URL("docker-compose.k2.yml", root), "utf8"),
    readFile(new URL("scripts/k2-deploy-app.sh", root), "utf8"),
    readFile(new URL("Dockerfile", root), "utf8"),
  ]);

  assert.match(terraform, /aws_paas_service" "postgres/);
  assert.match(terraform, /associate_public_ip_address = false/);
  assert.match(compose, /DATABASE_URL/);
  assert.match(deploy, /api\/v1\/health/);
  assert.match(dockerfile, /dist\/standalone\/server\.js/);
});

test("public K2 entrypoint is HTTPS-only and isolated from private APIs", async () => {
  const [caddy, compose, auth, app, terraform] = await Promise.all([
    readFile(new URL("Caddyfile", root), "utf8"),
    readFile(new URL("docker-compose.k2.yml", root), "utf8"),
    readFile(new URL("app/lib/server-auth.ts", root), "utf8"),
    readFile(new URL("app/components/GardenApp.tsx", root), "utf8"),
    readFile(new URL("infra/k2/terraform/main.tf", root), "utf8"),
  ]);

  assert.match(caddy, /profile shortlived/);
  assert.match(caddy, /@private_api path \/api\/v1\/\*/);
  assert.match(caddy, /Strict-Transport-Security/);
  assert.match(compose, /caddy:2\.11\.4-alpine/);
  assert.match(auth, /if \(await isPublicDemoRequest\(\)\) return null/);
  assert.match(app, /if \(isPreview\)[\s\S]*setSyncStatus\("saved"\)/);
  assert.match(terraform, /Public HTTPS for Garden Rhythm demo/);
});
