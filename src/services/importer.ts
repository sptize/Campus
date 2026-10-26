// Analiza la estructura REAL del Excel de horario (no asume una tabla convencional).
import { readWorkbook, cellKey, XlsxError, type Sheet } from './xlsx';
import { parseSpanishDate, weekdayMatches } from './dates';
import type { EventKind } from '../db/types';

export interface ImportMeta { career: string; level: string; course: string; semester: number | null; group: string; room: string; faculty: string; courseType: string }
export interface PSubject { symbol: string; name: string; professor: string | null; category: string | null }
export interface PSession {
  week: number | null; rawDate: string; date: string | null; rawSymbol: string;
  matchedSymbol: string | null; // símbolo canónico de la tabla de asignaturas
  turnStart: number; turnEnd: number; partial: boolean; include: boolean;
}
export interface PEvent { week: number | null; kind: EventKind; title: string; rawDate: string; startDate: string | null; endDate: string | null }
export interface Warning { level: 'aviso' | 'error'; text: string }
export interface ImportPreview { sheetName: string; meta: ImportMeta; subjects: PSubject[]; sessions: PSession[]; events: PEvent[]; warnings: Warning[] }

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const symKey = (s: string) => norm(s).replace(/[^a-z0-9]/g, '');
const sortedLetters = (s: string) => symKey(s).split('').sort().join('');

function findSheet(sheets: Sheet[]): Sheet | null {
  for (const sh of sheets) {
    const vals = [...sh.cells.values()].map(norm);
    if (vals.includes('semana') && vals.includes('asignatura')) return sh;
  }
  return null;
}

export async function parseSchedule(data: ArrayBuffer | Uint8Array): Promise<ImportPreview> {
  const wb = await readWorkbook(data);
  const sh = findSheet(wb.sheets);
  if (!sh) throw new XlsxError('No se reconoció la estructura del horario: faltan las celdas "SEMANA" y "Asignatura".');
  const warnings: Warning[] = [];
  const get = (r: number, c: number) => sh.cells.get(cellKey(r, c)) ?? '';
  const entries = [...sh.cells.entries()].map(([k, v]) => { const [r, c] = k.split(',').map(Number); return { r, c, v }; }).sort((a, b) => a.r - b.r || a.c - b.c);

  // 1) Metadatos
  const meta: ImportMeta = { career: '', level: '', course: '', semester: null, group: '', room: '', faculty: '', courseType: '' };
  for (const { v } of entries) {
    if (/^facultad\b/i.test(v) && !meta.faculty) { meta.faculty = v; continue; }
    const m = v.match(/^([^:]{2,25}):\s*(.*)$/);
    if (!m) continue;
    const val = m[2].trim();
    switch (norm(m[1])) {
      case 'carrera': meta.career = val; break;
      case 'semestre': { const n = val.match(/\d+/); meta.semester = n ? +n[0] : null; break; }
      case 'ano academico': meta.level = val; break;
      case 'curso': meta.course = val; break;
      case 'tipo de curso': meta.courseType = val; break;
      case 'aula': meta.room = val; break;
      case 'grupo': meta.group = val; break;
    }
  }
  if (!meta.course) warnings.push({ level: 'error', text: 'No se encontró el curso académico (p. ej. "CURSO: 2026-2027"); las fechas no se pueden completar con el año.' });
  if (meta.semester === null) warnings.push({ level: 'error', text: 'No se encontró el número de semestre.' });
  if (!meta.career) warnings.push({ level: 'error', text: 'No se encontró la carrera.' });

  // 2) Tabla de asignaturas
  const subjHead = entries.find((e) => norm(e.v) === 'asignatura')!;
  const row = subjHead.r;
  const symCol = entries.find((e) => e.r === row && norm(e.v) === 'simbolo')?.c;
  const profCol = entries.find((e) => e.r === row && norm(e.v).startsWith('profesor'))?.c;
  const catCol = entries.find((e) => e.r === row && norm(e.v).startsWith('cat'))?.c;
  const subjects: PSubject[] = [];
  if (symCol === undefined) warnings.push({ level: 'error', text: 'La tabla de asignaturas no tiene columna "Símbolo".' });
  else for (let r = row + 1; get(r, symCol); r++) {
    subjects.push({ symbol: get(r, symCol), name: get(r, subjHead.c), professor: profCol !== undefined ? get(r, profCol) || null : null, category: catCol !== undefined ? get(r, catCol) || null : null });
  }
  for (const s of subjects) if (!s.professor) warnings.push({ level: 'aviso', text: `${s.name} (${s.symbol}) no tiene profesor en el Excel; se mostrará "Sin nombre".` });

  // 3) Cuadrícula de semanas/turnos
  const weekHead = entries.find((e) => norm(e.v) === 'semana')!;
  const hr = weekHead.r;
  const dateCol = entries.find((e) => e.r === hr && norm(e.v) === 'fechas')?.c ?? weekHead.c + 1;
  const turnCols = new Map<number, number>(); // columna -> número de turno
  for (const e of entries) if (e.r === hr && e.c > dateCol && /^\d+$/.test(e.v)) turnCols.set(e.c, +e.v);
  if (!turnCols.size) throw new XlsxError('No se encontraron las columnas de turnos (1, 2, 3…) junto a "SEMANA".');
  const lastTurnCol = Math.max(...turnCols.keys());
  const colOfTurn = (n: number) => [...turnCols.entries()].find(([, t]) => t === n)?.[0];

  const resolve = (raw: string): string | null => {
    const k = symKey(raw);
    const exact = subjects.find((s) => symKey(s.symbol) === k);
    if (exact) return exact.symbol;
    const alias = subjects.find((s) => sortedLetters(s.symbol) === sortedLetters(raw));
    if (alias) { warnings.push({ level: 'aviso', text: `El símbolo "${raw}" de la cuadrícula no existe en la tabla de asignaturas; se vinculó a "${alias.symbol}" (${alias.name}) porque tiene las mismas letras. Revísalo.` }); return alias.symbol; }
    return null;
  };

  const sessions: PSession[] = []; const events: PEvent[] = [];
  const seen = new Set<string>();
  for (let r = hr + 1; r <= sh.maxRow; r++) {
    let any = false;
    for (let c = weekHead.c; c <= lastTurnCol; c++) if (get(r, c)) { any = true; break; }
    if (!any) break;
    const weekTxt = get(r, weekHead.c); const week = /^\d+$/.test(weekTxt) ? +weekTxt : null;
    const rawDate = get(r, dateCol);
    const cells = [...turnCols.keys()].map((c) => ({ c, text: get(r, c) })).filter((x) => x.text);
    const bigText = cells.find((x) => x.text.length >= 6 && !resolveQuiet(x.text, subjects));
    if (/receso/i.test(rawDate) || bigText) {
      const title = bigText?.text ?? rawDate;
      const n = norm(title + ' ' + rawDate);
      const kind: EventKind = /receso/.test(n) ? 'receso' : /extraordinari/.test(n) ? 'examen_extra' : /ordinari/.test(n) ? 'examen_ordinario' : /mundial/.test(n) ? 'mundiales' : 'otro';
      const p = parseSpanishDate(rawDate, meta.course || null);
      if (!p.ok) warnings.push({ level: 'aviso', text: `"${title}" (semana ${week ?? '?'}) no tiene fecha en el Excel; quedará como pendiente de confirmar, sin fecha inventada.` });
      events.push({ week, kind, title: title.replace(/\s+/g, ' '), rawDate, startDate: p.start, endDate: p.end });
      continue;
    }
    const p = parseSpanishDate(rawDate, meta.course || null);
    if (!p.ok) warnings.push({ level: 'error', text: `Semana ${week ?? '?'}: no se pudo interpretar la fecha "${rawDate}". Corrígela en la vista previa.` });
    else if (p.start && !weekdayMatches(p.start, p.weekdayHint)) warnings.push({ level: 'aviso', text: `Semana ${week ?? '?'}: "${rawDate}" no coincide con el día de la semana real de esa fecha.` });
    for (const { c, text } of cells) {
      const partial = text.includes('∆');
      const raw = text.replace('∆', '').trim();
      const turnStart = turnCols.get(c)!;
      const mg = sh.merges.find((m) => m.r1 === r && m.c1 === c);
      let turnEnd = turnStart;
      if (mg) turnEnd = turnCols.get(mg.c2) ?? turnStart + (mg.c2 - mg.c1);
      else warnings.push({ level: 'aviso', text: `Semana ${week ?? '?'}: "${raw}" ocupa una sola celda (turno ${turnStart}); no hay celdas combinadas que indiquen más turnos.` });
      const matched = resolve(raw);
      if (!matched) warnings.push({ level: 'error', text: `Semana ${week ?? '?'}: el símbolo "${raw}" no coincide con ninguna asignatura. Elige una en la vista previa.` });
      const dupKey = `${p.start}_${turnStart}_${symKey(raw)}`;
      if (p.start && seen.has(dupKey)) { warnings.push({ level: 'aviso', text: `Sesión duplicada ignorada: ${raw} el ${p.start}.` }); continue; }
      if (p.start) seen.add(dupKey);
      sessions.push({ week, rawDate, date: p.start, rawSymbol: raw, matchedSymbol: matched, turnStart, turnEnd, partial, include: true });
    }
  }
  void colOfTurn;
  for (const s of subjects) if (!sessions.some((x) => x.matchedSymbol === s.symbol)) warnings.push({ level: 'aviso', text: `${s.name} (${s.symbol}) aparece en la tabla pero no tiene clases en la cuadrícula.` });
  if (!sessions.length) warnings.push({ level: 'error', text: 'No se detectó ninguna clase en la cuadrícula.' });
  return { sheetName: sh.name, meta, subjects, sessions, events, warnings };
}

function resolveQuiet(raw: string, subjects: PSubject[]): boolean {
  const k = symKey(raw.replace('∆', ''));
  return subjects.some((s) => symKey(s.symbol) === k || sortedLetters(s.symbol) === sortedLetters(raw.replace('∆', '')));
}

export async function sha256Hex(buf: ArrayBuffer | Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf instanceof Uint8Array ? (buf as unknown as BufferSource) : buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
