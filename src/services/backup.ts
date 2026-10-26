// Copias de seguridad: exportación JSON versionada, validación previa y restauración transaccional.
import { ALL_TABLES, transact, getSetting, setSetting, SCHEMA_VERSION, years, semesters, subjects, sessions, events, notes, objectives, evaluations, assignments, imports, settings } from '../db/idb';
import { APP_VERSION, BACKUP_APP_ID, BACKUP_FORMAT_VERSION } from '../config';
import { isISO } from './dates';

export const TABLE_NAMES = ['years', 'semesters', 'subjects', 'sessions', 'events', 'notes', 'objectives', 'evaluations', 'assignments', 'imports', 'settings'] as const;
export type TableName = (typeof TABLE_NAMES)[number];
export interface BackupFile {
  app: string; formatVersion: number; schemaVersion: number; appVersion: string; exportedAt: string;
  includesOriginalExcel: false; data: Record<TableName, any[]>;
}

export async function buildBackup(): Promise<BackupFile> {
  const data = {} as Record<TableName, any[]>;
  for (const t of ALL_TABLES) {
    const rows = await t.all();
    data[t.name as TableName] = t.name === 'imports' ? rows.map((r: any) => ({ ...r, original: null })) : rows; // los Excel originales NO se incluyen
  }
  return { app: BACKUP_APP_ID, formatVersion: BACKUP_FORMAT_VERSION, schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), includesOriginalExcel: false, data };
}
export async function markBackupDone() { await setSetting('lastBackupAt', Date.now()); }
export const backupFileName = () => `campuspocket-copia-${new Date().toISOString().slice(0, 10)}.json`;

export interface Validation { ok: boolean; errors: string[]; warnings: string[]; counts: Record<string, number>; exportedAt: string | null; appVersion: string | null }
const keyOf = (t: TableName) => (t === 'settings' ? 'key' : 'id');
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

export function validateBackup(raw: unknown): Validation {
  const v: Validation = { ok: false, errors: [], warnings: [], counts: {}, exportedAt: null, appVersion: null };
  if (!isObj(raw)) { v.errors.push('El archivo no contiene una copia de seguridad (no es un objeto JSON).'); return v; }
  if (raw.app !== BACKUP_APP_ID) { v.errors.push('Este archivo no es una copia de seguridad de CampusPocket.'); return v; }
  if (typeof raw.formatVersion !== 'number' || raw.formatVersion < 1) { v.errors.push('La copia no indica una versión de formato válida.'); return v; }
  if (raw.formatVersion > BACKUP_FORMAT_VERSION) { v.errors.push(`La copia usa el formato ${raw.formatVersion}, más nuevo que el que entiende esta app (${BACKUP_FORMAT_VERSION}). Actualiza la app antes de restaurarla.`); return v; }
  v.exportedAt = typeof raw.exportedAt === 'string' ? raw.exportedAt : null;
  v.appVersion = typeof raw.appVersion === 'string' ? raw.appVersion : null;
  if (!isObj(raw.data)) { v.errors.push('La copia no contiene el bloque de datos.'); return v; }
  const ids: Record<string, Set<string>> = {};
  for (const t of TABLE_NAMES) {
    const rows = raw.data[t];
    if (rows === undefined) { if (!['imports', 'settings'].includes(t)) v.errors.push(`Falta la tabla "${t}".`); v.counts[t] = 0; ids[t] = new Set(); continue; }
    if (!Array.isArray(rows)) { v.errors.push(`La tabla "${t}" no es una lista.`); continue; }
    ids[t] = new Set(); v.counts[t] = rows.length;
    rows.forEach((r, i) => {
      const k = isObj(r) ? r[keyOf(t)] : undefined;
      if (typeof k !== 'string' || !k) { v.errors.push(`${t}[${i}]: registro sin identificador.`); return; }
      if (ids[t].has(k)) v.errors.push(`${t}: identificador repetido "${k}".`);
      ids[t].add(k);
    });
  }
  for (const k of Object.keys(raw.data)) if (!(TABLE_NAMES as readonly string[]).includes(k)) v.warnings.push(`Tabla desconocida ignorada: "${k}".`);
  if (v.errors.length) return v;
  const ref = (t: TableName, field: string, target: TableName, nullable = false) => {
    for (const r of raw.data[t] ?? []) {
      const val = r[field];
      if (val === null || val === undefined) { if (nullable) continue; v.errors.push(`${t} "${r.id}": falta ${field}.`); continue; }
      if (!ids[target].has(val)) v.errors.push(`${t} "${r.id}": ${field} apunta a un registro inexistente (${target}).`);
    }
  };
  ref('semesters', 'yearId', 'years'); ref('subjects', 'semesterId', 'semesters');
  ref('sessions', 'semesterId', 'semesters'); ref('sessions', 'subjectId', 'subjects', true);
  ref('events', 'semesterId', 'semesters'); ref('notes', 'subjectId', 'subjects');
  ref('objectives', 'subjectId', 'subjects'); ref('evaluations', 'subjectId', 'subjects'); ref('assignments', 'subjectId', 'subjects');
  for (const s of raw.data.sessions ?? []) if (!isISO(s.date) || typeof s.turnStart !== 'number' || typeof s.turnEnd !== 'number') v.errors.push(`sessions "${s.id}": fecha o turnos inválidos.`);
  for (const a of raw.data.assignments ?? []) if (!Array.isArray(a.subtasks)) v.errors.push(`assignments "${a.id}": subtareas inválidas.`);
  for (const e of raw.data.evaluations ?? []) if (!['pendiente', 'preparacion', 'realizada', 'calificada'].includes(e.status)) v.errors.push(`evaluations "${e.id}": estado inválido.`);
  v.errors = v.errors.slice(0, 20);
  v.ok = v.errors.length === 0;
  return v;
}

export async function localCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of ALL_TABLES) out[t.name] = await t.count();
  return out;
}

export interface RestoreResult { added: Record<string, number>; skipped: Record<string, number> }

/** Valida primero; solo si es válida toca la base. replace = reemplaza todo; merge = añade lo que no existe (los ids locales no se modifican). */
export async function restoreBackup(raw: unknown, mode: 'replace' | 'merge'): Promise<RestoreResult> {
  const v = validateBackup(raw);
  if (!v.ok) throw new Error('La copia no es válida: ' + v.errors[0]);
  const data = (raw as BackupFile).data;
  const added: Record<string, number> = {}, skipped: Record<string, number> = {};
  const tables = { years, semesters, subjects, sessions, events, notes, objectives, evaluations, assignments, imports, settings } as const;
  await transact(ALL_TABLES, async () => {
    for (const name of TABLE_NAMES) {
      const t = tables[name] as any; const rows: any[] = (data[name] ?? []).map((r: any) => (name === 'imports' ? { ...r, original: null } : r));
      if (mode === 'replace') { await t.clear(); await t.bulkPut(rows); added[name] = rows.length; skipped[name] = 0; continue; }
      if (name === 'settings') { added[name] = 0; skipped[name] = rows.length; continue; }
      const existing = new Set((await t.all()).map((x: any) => x[keyOf(name)]));
      const fresh = rows.filter((r) => !existing.has(r[keyOf(name)]));
      await t.bulkPut(fresh); added[name] = fresh.length; skipped[name] = rows.length - fresh.length;
    }
  });
  return { added, skipped };
}
export { getSetting };
