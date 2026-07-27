import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("build contains the garden assistant worker and assets", async () => {
  await Promise.all([
    access(new URL("dist/server/index.js", root)),
    access(new URL("dist/client/og.png", root)),
    access(new URL("dist/client/icon.png", root)),
    access(new URL("dist/.openai/hosting.json", root)),
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
  assert.match(weather, /open-meteo\.com/);
  assert.match(state, /revision_conflict/);
  assert.match(state, /idempotency_keys/);
  assert.match(assistant, /status: "queued"/);
});
