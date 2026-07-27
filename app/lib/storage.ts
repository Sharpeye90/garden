import type { GardenState } from "../types";

const DB_NAME = "garden-rhythm";
const STORE_NAME = "garden-state";
const STATE_KEY = "primary";

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

export async function readLocalState(): Promise<GardenState | null> {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => resolve((request.result as GardenState) ?? null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

export async function writeLocalState(state: GardenState): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(state, STATE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
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
