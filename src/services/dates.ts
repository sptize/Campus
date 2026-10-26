// Fechas como cadenas ISO locales "YYYY-MM-DD" (sin zonas horarias ni desfases).
const pad = (n: number) => String(n).padStart(2, '0');
export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromISO = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const todayISO = () => toISO(new Date());
export const addDays = (iso: string, n: number) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
export const daysBetween = (a: string, b: string) => Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 86400000);
export const startOfWeek = (iso: string) => { const d = fromISO(iso); const wd = (d.getDay() + 6) % 7; return addDays(iso, -wd); };
export const isISO = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(fromISO(s).getTime());

const cap = (s: string) => s.replace(/^(\p{L}+),/u, '$1').charAt(0).toUpperCase() + s.replace(/^(\p{L}+),/u, '$1').slice(1);
export const fmtLong = (iso: string) => cap(fromISO(iso).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }));
export const fmtFull = (iso: string) => cap(fromISO(iso).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
export const fmtShort = (iso: string) => fromISO(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
export const fmtMonth = (iso: string) => cap(fromISO(iso).toLocaleDateString('es', { month: 'long', year: 'numeric' }));
export const weekdayName = (iso: string) => cap(fromISO(iso).toLocaleDateString('es', { weekday: 'long' }));

export const hhmmToMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
export const minToHHMM = (n: number) => `${pad(Math.floor(n / 60) % 24)}:${pad(n % 60)}`;

/** Turno n (1-based) dura `mins` y el turno 1 empieza en `startTime`. Devuelve inicio del primero y fin del último. */
export function turnRange(turnStart: number, turnEnd: number, startTime: string, mins: number) {
  const base = hhmmToMin(startTime);
  return { start: minToHHMM(base + (turnStart - 1) * mins), end: minToHHMM(base + turnEnd * mins) };
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const MONTHS: Record<string, number> = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, set: 8, oct: 9, nov: 10, dic: 11 };

/** El año se deduce del curso "2026-2027": agosto-diciembre = primer año; enero-julio = segundo. */
function yearFor(month: number, course: string | null): number | null {
  const m = course?.match(/(\d{4})\D+(\d{4})/);
  if (!m) return null;
  return month >= 7 ? +m[1] : +m[2];
}

export interface ParsedDate { start: string | null; end: string | null; weekdayHint: string | null; ok: boolean }

/** Interpreta "jueves 3 sept", "juves 15 oct", "jueves 1ero oct", "18-23 ene". */
export function parseSpanishDate(text: string, course: string | null): ParsedDate {
  const t = norm(text);
  const wd = t.match(/^(lu|ma|mi|ju|vi|sa|do)/)?.[1] ?? null;
  const weekdayHint = wd ? ({ lu: 'lunes', ma: 'martes', mi: 'miercoles', ju: 'jueves', vi: 'viernes', sa: 'sabado', do: 'domingo' } as Record<string, string>)[wd] : null;
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { start: iso[0], end: null, weekdayHint, ok: true };
  const range = t.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([a-z]{3,})/);
  const single = t.match(/(\d{1,2})\s*(?:ero|er|ro|o|º|°)?\s+([a-z]{3,})/);
  const pick = range ?? single;
  if (!pick) return { start: null, end: null, weekdayHint, ok: false };
  const monthWord = range ? range[3] : single![2];
  const month = MONTHS[monthWord.slice(0, 3)];
  if (month === undefined) return { start: null, end: null, weekdayHint, ok: false };
  const year = yearFor(month, course);
  if (year === null) return { start: null, end: null, weekdayHint, ok: false };
  const mk = (day: number) => toISO(new Date(year, month, day, 12));
  const d1 = +pick[1];
  return range ? { start: mk(d1), end: mk(+range[2]), weekdayHint, ok: true } : { start: mk(d1), end: null, weekdayHint, ok: true };
}

export function weekdayMatches(iso: string, hint: string | null): boolean {
  if (!hint) return true;
  const names = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  return names[fromISO(iso).getDay()] === hint;
}
