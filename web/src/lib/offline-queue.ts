/**
 * Fila de mutações offline baseada em IndexedDB.
 *
 * Quando o cliente está sem conexão, requisições mutáveis (POST/PUT/PATCH/DELETE)
 * são enfileiradas aqui com uma `Idempotency-Key`. Quando a conexão retorna,
 * as requisições são reproduzidas em ordem. A idempotência no servidor garante
 * que reenvios seguros não duplicem efeitos colaterais.
 *
 * Cada entrada armazena:
 * - id: identificador interno da fila (UUIDv4)
 * - key: Idempotency-Key enviada ao servidor
 * - method: HTTP method
 * - path: caminho da requisição (ex.: /api/v1/transactions)
 * - body: corpo serializado (JSON string ou null)
 * - createdAt: timestamp de criação
 */

const DB_NAME = "vivabem-offline-queue";
const DB_VERSION = 1;
const STORE_NAME = "pending";

interface QueueEntry {
  id: string;
  key: string;
  method: string;
  path: string;
  body: string | null;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("byKey", "key", { unique: false });
        store.createIndex("byCreatedAt", "createdAt", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function closeDB(): void {
  dbPromise?.then((database) => database.close());
  dbPromise = null;
}

/**
 * Enfileira uma mutação para execução posterior (offline).
 */
export async function enqueueMutation(
  key: string,
  method: string,
  path: string,
  body: unknown,
): Promise<void> {
  const database = await openDB();
  const entry: QueueEntry = {
    id: crypto.randomUUID(),
    key,
    method,
    path,
    body: body === undefined ? null : JSON.stringify(body),
    createdAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.add(entry);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retorna todas as entradas enfileiradas, ordenadas por criação.
 */
export async function listPending(): Promise<QueueEntry[]> {
  const database = await openDB();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("byCreatedAt");
    const req = index.getAll();

    req.onsuccess = () => resolve(req.result as QueueEntry[]);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Remove uma entrada da fila após execução bem-sucedida.
 */
export async function removeFromQueue(id: string): Promise<void> {
  const database = await openDB();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Remove todas as entradas da fila (usado após replay completo).
 */
export async function clearQueue(): Promise<void> {
  const database = await openDB();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.clear();

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Conta quantas entradas estão pendentes.
 */
export async function pendingCount(): Promise<number> {
  const database = await openDB();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.count();

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
