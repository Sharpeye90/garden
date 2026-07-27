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

test("plant placement connects catalog, plan, care tasks and journal", async () => {
  const [types, data, app, canvas, plantings, storage] = await Promise.all([
    readFile(new URL("app/types.ts", root), "utf8"),
    readFile(new URL("app/data.ts", root), "utf8"),
    readFile(new URL("app/components/GardenApp.tsx", root), "utf8"),
    readFile(new URL("app/components/GardenCanvas.tsx", root), "utf8"),
    readFile(new URL("app/lib/plantings.ts", root), "utf8"),
    readFile(new URL("app/lib/storage.ts", root), "utf8"),
  ]);

  assert.match(types, /export type Planting =/);
  assert.match(types, /plantingId\?: string/);
  assert.match(data, /INITIAL_PLANTINGS/);
  assert.match(app, /placePendingPlant/);
  assert.match(app, /createCareTask\(pendingPlant, planting, zone\)/);
  assert.match(app, /связь с посадкой сохранена/);
  assert.match(canvas, /data-placing=/);
  assert.match(canvas, /PlantingMarker/);
  assert.match(plantings, /findPlacementTarget/);
  assert.match(plantings, /observe\.soil-moisture\.vegetable\.v1/);
  assert.match(storage, /normalizeState/);
});
