import { h } from './h';
import { icon, type IconName } from './icons';
import { formModal, toast, reportError } from './modal';
import { subjects } from '../db/idb';
import type { Subject, Session, Semester } from '../db/types';
import { subjectColor, sessionTimes } from '../services/status';
import { fmtLong } from '../services/dates';

export function badge(sub: Pick<Subject, 'code' | 'colorIndex'> | undefined, fallback = '?') {
  const c = subjectColor(sub?.colorIndex ?? 0);
  return h('span', { class: 'badge', style: `background:${c.bg};color:${c.fg}` }, sub?.code ?? fallback);
}
export function emptyState(ic: IconName, title: string, text: string, ...actions: Node[]) {
  return h('div', { class: 'empty' }, icon(ic, 56), h('h2', null, title), h('p', null, text), ...actions);
}
export const profLabel = (s: Subject) => s.professor ?? 'Sin nombre';

export function editProfessor(s: Subject, done: () => void) {
  formModal({
    title: s.professor ? 'Editar profesor' : 'Agregar nombre de profesor',
    intro: `${s.name} (${s.code})`,
    fields: [{ name: 'professor', label: 'Nombre del profesor', type: 'text', value: s.professor ?? '', placeholder: 'Nombre y apellidos' }],
    onSubmit: async (v) => { await subjects.put({ ...s, professor: v.professor || null, edited: true }); toast('Profesor guardado'); done(); },
  });
}
export function profLine(s: Subject, done: () => void) {
  return h('span', { class: 'row', style: 'gap:6px' }, icon('user', 16), 'Profesor: ', h('strong', null, profLabel(s)),
    h('button', { class: 'btn sm ghost', type: 'button', onClick: () => editProfessor(s, done) }, s.professor ? 'Editar' : 'Agregar nombre de profesor'));
}

export function sessionCard(s: Session, sub: Subject | undefined, sem: Semester, o: { date?: boolean; onEdit?: () => void; refresh?: () => void } = {}) {
  const t = sessionTimes(s, sem); const c = subjectColor(sub?.colorIndex ?? 0);
  return h('article', { class: 'card sess', style: `border-left-color:${c.fg}` },
    h('div', { class: 'row between' },
      h('div', { class: 'time' }, icon('clock', 18), `${t.start} – ${t.end}`, o.date ? h('span', { class: 'soft', style: 'font-weight:500' }, ' · ' + fmtLong(s.date)) : null),
      o.onEdit ? h('button', { class: 'icon-btn plain', type: 'button', 'aria-label': 'Editar esta clase', onClick: o.onEdit }, icon('pencil')) : null),
    h('div', { class: 'row', style: 'margin-top:4px' }, badge(sub, s.symbol), h('strong', null, sub?.name ?? `Asignatura sin asignar (${s.symbol})`),
      s.partial ? h('span', { class: 'tag warn' }, '∆ Prueba parcial') : null),
    h('div', { class: 'meta' }, h('span', null, `Turnos ${s.turnStart}–${s.turnEnd}`), s.room ? h('span', null, icon('pin', 14), ' Aula ' + s.room) : null,
      sub ? (o.refresh ? profLine(sub, o.refresh) : h('span', null, 'Profesor: ' + profLabel(sub))) : null));
}

export function pageTitle(text: string, ...right: Node[]) {
  return h('div', { class: 'row between', style: 'margin-bottom:10px' }, h('h2', null, text), h('div', { class: 'row' }, ...right));
}
export function subjectSelect(list: Subject[], value: string, onChange: (v: string) => void, withAll = true) {
  const s = h('select', { 'aria-label': 'Filtrar por asignatura', onChange: () => onChange(s.value) },
    withAll ? h('option', { value: '' }, 'Todas las asignaturas') : null, list.map((x) => h('option', { value: x.id, selected: x.id === value }, `${x.code} · ${x.name}`)));
  s.value = value; return s;
}
export async function guarded<T>(fn: () => Promise<T>, msg?: string): Promise<T | undefined> { try { return await fn(); } catch (e) { reportError(e, msg); return undefined; } }
export const uniq = <T,>(a: T[]) => [...new Set(a)];
