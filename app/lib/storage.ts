import { INITIAL_PLANTINGS, INITIAL_STATE } from "../data";
import { dateKey, shiftDateKey } from "./dates";
import type { GardenState, Planting } from "../types";

const DB_NAME = "garden-rhythm";
const STORE_NAME = "garden-state";
const PREVIEW_STATE_KEY = "primary";

function normalizeState(saved: GardenState): GardenState {
  const legacy = saved as GardenState & {
    plantings?: Planting[];
    location?: GardenState["location"];
  };

  const plantIds = new Set(legacy.plants.map((plant) => plant.id));
  const objectIds = new Set(legacy.planObjects.map((object) => object.id));
  return {
    ...legacy,
    location: legacy.location ?? INITIAL_STATE.location,
    tasks: legacy.tasks.map((task) => ({
      ...task,
      scheduledFor:
        task.scheduledFor ??
        (task.id === "check-tomatoes"
          ? shiftDateKey(dateKey(), 1)
          : task.id === "deadhead-echinacea"
            ? shiftDateKey(dateKey(), 3)
            : dateKey()),
    })),
    plantings: Array.isArray(legacy.plantings)
      ? legacy.plantings
      : INITIAL_PLANTINGS.filter(
          (planting) =>
            plantIds.has(planting.plantId) &&
            (!planting.planObjectId || objectIds.has(planting.planObjectId)),
        ),
  };
}

function stateKey(accountKey?: string | null): string {
  return accountKey ? `account:${accountKey.toLowerCase()}` : PREVIEW_STATE_KEY;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readLocalState(
  accountKey?: string | null,
): Promise<GardenState | null> {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(stateKey(accountKey));
    request.onsuccess = () => {
      const saved = request.result as GardenState | undefined;
      resolve(saved ? normalizeState(saved) : null);
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

export async function writeLocalState(
  state: GardenState,
  accountKey?: string | null,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(state, stateKey(accountKey));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}


export async function readRemoteState(): Promise<GardenState | null> {
  try {
    const response = await fetch("/api/v1/state", { cache: "no-store" });
    if (response.status === 204) return null;
    if (!response.ok) return null;
    const payload = (await response.json()) as { state?: GardenState };
    return payload.state ? normalizeState(payload.state) : null;
  } catch {
    return null;
  }
}

export async function syncRemoteState(
  state: GardenState,
): Promise<{ revision: number } | null> {
  try {
    const response = await fetch("/api/v1/state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state,
        expectedRevision: Math.max(0, state.revision - 1),
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    if (!response.ok) return null;
    return (await response.json()) as { revision: number };
  } catch {
    return null;
  }
}
