// Capa mínima sobre IndexedDB nativo: tablas tipadas, transacciones y migraciones versionadas.
import { DB_NAME } from '../config';
import type * as T from './types';

interface StoreDef { keyPath: string; indexes: string[] }

// MIGRACIONES: cada entrada es una versión del esquema. NUNCA edites una existente;
// para cambiar el esquema añade una función nueva al final (solo crea/añade, no borra datos).
const MIGRATIONS: Array<(db: IDBDatabase, tx: IDBTransaction) => void> = [
  (db) => {
    const defs: Record<string, StoreDef> = {
      years: { keyPath: 'id', indexes: ['course'] },
      semesters: { keyPath: 'id', indexes: ['yearId'] },
      subjects: { keyPath: 'id', indexes: ['semesterId'] },
      sessions: { keyPath: 'id', indexes: ['semesterId', 'date', 'subjectId'] },
      events: { keyPath: 'id', indexes: ['semesterId'] },
      notes: { keyPath: 'id', indexes: ['subjectId', 'semesterId'] },
      objectives: { keyPath: 'id', indexes: ['subjectId', 'semesterId'] },
      evaluations: { keyPath: 'id', indexes: ['subjectId', 'semesterId'] },
      assignments: { keyPath: 'id', indexes: ['subjectId', 'semesterId'] },
      imports: { keyPath: 'id', indexes: ['semesterId', 'hash'] },
      settings: { keyPath: 'key', indexes: [] },
    };
    for (const [name, d] of Object.entries(defs)) {
      const s = db.createObjectStore(name, { keyPath: d.keyPath });
      for (const ix of d.indexes) s.createIndex(ix, ix);
    }
  },
];
export const SCHEMA_VERSION = MIGRATIONS.length;

let dbPromise: Promise<IDBDatabase> | null = null;
let dbName = DB_NAME;
export function useDatabaseName(name: string) { dbName = name; dbPromise = null; }

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const rq = indexedDB.open(dbName, SCHEMA_VERSION);
      rq.onupgradeneeded = (ev) => {
        const tx = rq.transaction!;
        for (let v = ev.oldVersion; v < SCHEMA_VERSION; v++) MIGRATIONS[v](rq.result, tx);
      };
      rq.onsuccess = () => {
        rq.result.onversionchange = () => { rq.result.close(); dbPromise = null; };
        resolve(rq.result);
      };
      rq.onerror = () => { dbPromise = null; reject(rq.error); };
      rq.onblocked = () => reject(new Error('La base de datos está bloqueada por otra pestaña. Ciérrala e inténtalo de nuevo.'));
    });
  }
  return dbPromise;
}

const req = <R>(r: IDBRequest<R>): Promise<R> =>
  new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

let current: { tx: IDBTransaction; names: string[]; mode: IDBTransactionMode } | null = null;

export class Table<R extends object> {
  constructor(readonly name: string) {}
  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    if (current && current.names.includes(this.name) && (mode === 'readonly' || current.mode === 'readwrite'))
      return current.tx.objectStore(this.name);
    const db = await openDb();
    return db.transaction(this.name, mode).objectStore(this.name);
  }
  async get(key: string): Promise<R | undefined> { return req((await this.store('readonly')).get(key)) as Promise<R | undefined>; }
  async all(): Promise<R[]> { return req((await this.store('readonly')).getAll()) as Promise<R[]>; }
  async count(): Promise<number> { return req((await this.store('readonly')).count()); }
  async where(index: string, value: IDBValidKey): Promise<R[]> {
    return req((await this.store('readonly')).index(index).getAll(IDBKeyRange.only(value))) as Promise<R[]>;
  }
  async put(v: R): Promise<void> { await req((await this.store('readwrite')).put(v)); }
  async bulkPut(vs: R[]): Promise<void> { const s = await this.store('readwrite'); await Promise.all(vs.map((v) => req(s.put(v)))); }
  async delete(key: string): Promise<void> { await req((await this.store('readwrite')).delete(key)); }
  async bulkDelete(keys: string[]): Promise<void> { const s = await this.store('readwrite'); await Promise.all(keys.map((k) => req(s.delete(k)))); }
  async clear(): Promise<void> { await req((await this.store('readwrite')).clear()); }
}

/** Ejecuta fn dentro de UNA transacción atómica: si algo falla, no se guarda nada. */
export async function transact<R>(tables: Table<any>[], fn: () => Promise<R>): Promise<R> {
  const db = await openDb();
  const names = tables.map((t) => t.name);
  const tx = db.transaction(names, 'readwrite');
  const done = new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error ?? new Error('Transacción cancelada'));
  });
  const prev = current;
  current = { tx, names, mode: 'readwrite' };
  let out: R;
  try { out = await fn(); }
  catch (e) { try { tx.abort(); } catch { /* ya cerrada */ } await done.catch(() => {}); throw e; }
  finally { current = prev; }
  await done;
  return out;
}

export const years = new Table<T.Year>('years');
export const semesters = new Table<T.Semester>('semesters');
export const subjects = new Table<T.Subject>('subjects');
export const sessions = new Table<T.Session>('sessions');
export const events = new Table<T.SpecialEvent>('events');
export const notes = new Table<T.Note>('notes');
export const objectives = new Table<T.Objective>('objectives');
export const evaluations = new Table<T.Evaluation>('evaluations');
export const assignments = new Table<T.Assignment>('assignments');
export const imports = new Table<T.ImportRecord>('imports');
export const settings = new Table<T.Setting>('settings');
export const ALL_TABLES = [years, semesters, subjects, sessions, events, notes, objectives, evaluations, assignments, imports, settings];

export async function getSetting<V>(key: string, fallback: V): Promise<V> {
  const s = await settings.get(key);
  return s ? (s.value as V) : fallback;
}
export const setSetting = (key: string, value: unknown) => settings.put({ key, value });

export const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
