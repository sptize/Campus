import type { Assignment, Evaluation, Objective, Semester, SpecialEvent, Session, Subject } from '../db/types';
import { addDays, daysBetween } from './dates';
import { sessionTimes } from './status';

export type CalType = 'clase' | 'evento' | 'evaluacion' | 'entrega' | 'inicio' | 'objetivo';
export interface CalEvent {
  key: string; date: string; type: CalType; official: boolean; title: string; detail: string;
  subjectId: string | null; symbol: string; time: string; link: string | null;
}
export const CAL_LABEL: Record<CalType, string> = { clase: 'Clases', evento: 'Eventos académicos', evaluacion: 'Evaluaciones', entrega: 'Entregas', inicio: 'Inicio de trabajos', objetivo: 'Objetivos' };
// Oficial = viene del horario del Excel; Personal = lo registraste tú.
export const CAL_OFFICIAL: Record<CalType, boolean> = { clase: true, evento: true, evaluacion: false, entrega: false, inicio: false, objetivo: false };

export interface SemData { sem: Semester; subjects: Subject[]; sessions: Session[]; events: SpecialEvent[]; evaluations: Evaluation[]; assignments: Assignment[]; objectives: Objective[] }

export function collectEvents(d: SemData): CalEvent[] {
  const subj = new Map(d.subjects.map((s) => [s.id, s]));
  const out: CalEvent[] = [];
  for (const s of d.sessions) {
    const t = sessionTimes(s, d.sem); const sb = s.subjectId ? subj.get(s.subjectId) : undefined;
    out.push({ key: s.id, date: s.date, type: 'clase', official: true, title: sb?.name ?? s.symbol, detail: [s.room, `Turnos ${s.turnStart}–${s.turnEnd}`].filter(Boolean).join(' · '), subjectId: s.subjectId, symbol: s.symbol, time: `${t.start}–${t.end}`, link: null });
  }
  for (const e of d.events) {
    if (!e.startDate) continue;
    const end = e.endDate ?? e.startDate; const n = daysBetween(e.startDate, end);
    for (let i = 0; i <= n; i++) out.push({ key: `${e.id}_${i}`, date: addDays(e.startDate, i), type: 'evento', official: true, title: e.title, detail: e.endDate ? 'Período académico' : 'Evento académico', subjectId: null, symbol: '', time: '', link: null });
  }
  for (const e of d.evaluations) if (e.date) { const sb = subj.get(e.subjectId); out.push({ key: e.id, date: e.date, type: 'evaluacion', official: false, title: e.name, detail: `${e.typeLabel}${sb ? ' · ' + sb.name : ''}`, subjectId: e.subjectId, symbol: sb?.code ?? '', time: e.time, link: '#/planificador' }); }
  for (const a of d.assignments) {
    const sb = subj.get(a.subjectId);
    if (a.dueDate) out.push({ key: a.id + '_due', date: a.dueDate, type: 'entrega', official: false, title: a.title, detail: `Entrega${sb ? ' · ' + sb.name : ''}`, subjectId: a.subjectId, symbol: sb?.code ?? '', time: '', link: '#/planificador?tab=trabajos' });
    if (a.startDate) out.push({ key: a.id + '_start', date: a.startDate, type: 'inicio', official: false, title: a.title, detail: `Inicio${sb ? ' · ' + sb.name : ''}`, subjectId: a.subjectId, symbol: sb?.code ?? '', time: '', link: '#/planificador?tab=trabajos' });
  }
  for (const o of d.objectives) if (o.dueDate) { const sb = subj.get(o.subjectId); out.push({ key: o.id, date: o.dueDate, type: 'objetivo', official: false, title: o.title, detail: `Objetivo${sb ? ' · ' + sb.name : ''}`, subjectId: o.subjectId, symbol: sb?.code ?? '', time: '', link: null }); }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}
