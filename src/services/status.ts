// Reglas de negocio puras (sin base de datos): estados calculados, plazos, progreso.
import type { Assignment, Evaluation, Objective, Session, Semester } from '../db/types';
import { daysBetween, fromISO, hhmmToMin, turnRange } from './dates';

export type AsgView = 'atrasado' | 'pendiente' | 'en_curso' | 'completado' | 'entregado';

/** El estado "atrasado" se calcula al consultar (sin conexión): solo si no está completado/entregado y venció. */
export function assignmentStatus(a: Assignment, today: string): AsgView {
  if (a.status === 'entregado' || a.status === 'completado') return a.status;
  if (a.dueDate && a.dueDate < today) return 'atrasado';
  return a.status;
}
export function daysLeft(dueDate: string | null, today: string): number | null { return dueDate ? daysBetween(today, dueDate) : null; }
export function daysLabel(n: number | null): string {
  if (n === null) return 'Sin fecha límite';
  if (n === 0) return 'Vence hoy';
  if (n === 1) return 'Vence mañana';
  if (n === -1) return 'Venció ayer';
  return n > 0 ? `Faltan ${n} días` : `Atrasado ${-n} días`;
}
export function subtaskProgress(a: Assignment): number | null {
  if (!a.subtasks.length) return null;
  return Math.round((a.subtasks.filter((s) => s.done).length / a.subtasks.length) * 100);
}
export function isDueSoon(a: Assignment, today: string, within = 7): boolean {
  const st = assignmentStatus(a, today);
  if (st === 'atrasado' || st === 'completado' || st === 'entregado') return false;
  const d = daysLeft(a.dueDate, today);
  return d !== null && d >= 0 && d <= within;
}

export type EvalBucket = 'proxima' | 'vencida' | 'realizada';
export function evaluationBucket(e: Evaluation, today: string): EvalBucket {
  if (e.status === 'realizada' || e.status === 'calificada') return 'realizada';
  if (e.date && e.date < today) return 'vencida';
  return 'proxima';
}

export function objectiveProgress(list: Objective[]): { done: number; total: number; pct: number } {
  const total = list.length, done = list.filter((o) => o.status === 'completado').length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function sessionTimes(s: Pick<Session, 'turnStart' | 'turnEnd'>, sem: Pick<Semester, 'startTime' | 'turnMinutes'>) {
  return turnRange(s.turnStart, s.turnEnd, sem.startTime, sem.turnMinutes);
}

/** Próxima clase: la primera cuyo fin aún no ha pasado. `nowISO` y `nowMin` permiten probarla. */
export function nextSession(list: Session[], sem: Semester, nowISO: string, nowMin: number): Session | null {
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.turnStart - b.turnStart);
  return sorted.find((s) => s.date > nowISO || (s.date === nowISO && hhmmToMin(sessionTimes(s, sem).end) > nowMin)) ?? null;
}
export const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
export const isValidDay = (iso: string) => !isNaN(fromISO(iso).getTime());

export const SUBJECT_COLORS = [
  { bg: '#d3e9da', fg: '#2f5a45' }, { bg: '#d4e6ea', fg: '#2c5560' }, { bg: '#efe6cb', fg: '#6b5a22' },
  { bg: '#e5dcee', fg: '#523f69' }, { bg: '#f1ddd3', fg: '#74412b' }, { bg: '#dde9c8', fg: '#4a5e22' },
];
export const subjectColor = (i: number) => SUBJECT_COLORS[((i % SUBJECT_COLORS.length) + SUBJECT_COLORS.length) % SUBJECT_COLORS.length];
