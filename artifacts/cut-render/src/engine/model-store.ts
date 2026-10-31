/**
 * Imported model files are kept in the browser (IndexedDB) keyed by project id,
 * so a project re-opens with its model without re-importing.
 */
const DB_NAME = 'cut-render';
const STORE = 'models';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB nie je dostupná'));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

interface StoredModel {
  name: string;
  type: string;
  lastModified: number;
  data: ArrayBuffer;
}

export async function saveModelFile(projectId: number, file: File): Promise<void> {
  const record: StoredModel = { name: file.name, type: file.type, lastModified: file.lastModified, data: await file.arrayBuffer() };
  await tx('readwrite', (s) => s.put(record, projectId));
}

export async function loadModelFile(projectId: number): Promise<File | null> {
  const rec = (await tx('readonly', (s) => s.get(projectId))) as StoredModel | undefined;
  if (!rec) return null;
  return new File([rec.data], rec.name, { type: rec.type, lastModified: rec.lastModified });
}

export async function deleteModelFile(projectId: number): Promise<void> {
  await tx('readwrite', (s) => s.delete(projectId));
}
