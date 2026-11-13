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
 * - userId: dono da mutação; o replay só reproduz entradas do usuário ativo
 * - key: Idempotency-Key enviada ao servidor
 * - method: HTTP method
 * - path: caminho da requisição (ex.: /api/v1/transactions)
 * - body: corpo serializado (JSON string ou null)
 * - createdAt: timestamp de criação
 * - csrf: snapshot do token CSRF, usado pelo service worker quando não há
 *   aba aberta para renovar a sessão (o worker não lê `document.cookie`)
 */

const DB_NAME = "vivabem-offline-queue";
// v2: escopo por usuário. Entradas da v1 não têm dono confiável e são
// descartadas no upgrade (fail-closed).
const DB_VERSION = 2;
const STORE_NAME = "pending";
const META_STORE = "meta";
const OWNER_KEY = "activeUserId";

interface QueueEntry {
  id: string;
  userId: string;
  key: string;
  method: string;
  path: string;
  body: string | null;
  createdAt: number;
  csrf?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const database = req.result;
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
      const tx = req.transaction;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("byCreatedAt", "createdAt", { unique: false });
        store.createIndex("byUserId", "userId", { unique: false });
      } else if (tx !== null) {
        const store = tx.objectStore(STORE_NAME);
        if (oldVersion < 2) {
          store.clear();
        }
        if (!store.indexNames.contains("byUserId")) {
          store.createIndex("byUserId", "userId", { unique: false });
        }
      }

      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "key" });
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
  userId: string,
  key: string,
  method: string,
  path: string,
  body: unknown,
  csrf?: string,
): Promise<void> {
  const database = await openDB();
  const entry: QueueEntry = {
    id: crypto.randomUUID(),
    userId,
    key,
    method,
    path,
    body: body === undefined ? null : JSON.stringify(body),
    createdAt: Date.now(),
    ...(csrf === undefined ? {} : { csrf }),
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
 * Retorna as entradas enfileiradas, ordenadas por criação.
 *
 * Sem `userId`, devolve a fila inteira (usado apenas pelo service worker para
 * inspeção); o replay sempre passa o dono ativo.
 */
export async function listPending(userId?: string): Promise<QueueEntry[]> {
  const database = await openDB();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const source = userId === undefined ? store.index("byCreatedAt") : store.index("byUserId");
    const req = userId === undefined ? source.getAll() : source.getAll(userId);

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
 * Remove as entradas da fila. Com `userId`, remove apenas as do usuário
 * (logout); sem ele, limpa a fila inteira (reset/upgrade).
 */
export async function clearQueue(userId?: string): Promise<void> {
  const database = await openDB();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    if (userId === undefined) {
      store.clear();
    } else {
      const index = store.index("byUserId");
      const req = index.openKeyCursor(IDBKeyRange.only(userId));

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor === null) return;
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Registra qual usuário é o dono da sessão atual.
 *
 * O service worker não consegue ler o JWT HttpOnly; este valor persistido
 * permite que ele reproduza apenas a fila do dono. `null` no logout impede
 * replay com uma sessão de outra conta.
 */
export async function setQueueOwner(userId: string | null): Promise<void> {
  const database = await openDB();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(META_STORE, "readwrite");
    const store = tx.objectStore(META_STORE);

    if (userId === null) {
      store.delete(OWNER_KEY);
    } else {
      store.put({ key: OWNER_KEY, value: userId });
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Dono persistido da fila; `null` quando nenhuma sessão foi registrada. */
export async function getQueueOwner(): Promise<string | null> {
  const database = await openDB();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(META_STORE, "readonly");
    const store = tx.objectStore(META_STORE);
    const req = store.get(OWNER_KEY);

    req.onsuccess = () => {
      const record = req.result as { value?: unknown } | undefined;
      resolve(typeof record?.value === "string" ? record.value : null);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Atualiza o snapshot de CSRF das entradas pendentes do dono ativo.
 *
 * O token é rotacionado pelo servidor; sem isso o replay no service worker
 * acumularia 403 até a próxima vez que a aba estivesse aberta.
 */
export async function updateCsrfSnapshot(csrf: string, userId?: string): Promise<void> {
  const entries = await listPending(userId);
  if (entries.length === 0) return;

  const database = await openDB();

  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    for (const entry of entries) {
      store.put({ ...entry, csrf });
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Conta quantas entradas estão pendentes (opcionalmente de um usuário).
 */
export async function pendingCount(userId?: string): Promise<number> {
  const database = await openDB();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const source = userId === undefined ? store : store.index("byUserId");
    const req = userId === undefined ? source.count() : source.count(userId);

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export { closeDB };
