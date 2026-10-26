import { h } from '../ui/h';
import { icon } from '../ui/icons';
import { loadActive, type Ctx } from '../app/context';
import { refresh, setQuery } from '../app/router';
import { badge, emptyState, pageTitle, subjectSelect } from '../ui/parts';
import { formModal, confirmDialog, toast } from '../ui/modal';
import { evaluations, assignments, uid } from '../db/idb';
import type { Assignment, EvalStatus, EvalType, Evaluation, Priority, Subtask } from '../db/types';
import { fmtLong, todayISO } from '../services/dates';
import { assignmentStatus, daysLabel, daysLeft, evaluationBucket, isDueSoon, subtaskProgress } from '../services/status';

let filter = '';
export const EVAL_TYPES: Record<EvalType, string> = { parcial: 'Prueba parcial', final: 'Examen final', seminario: 'Seminario', trabajo: 'Trabajo evaluativo', practica: 'Práctica', proyecto: 'Proyecto', otra: 'Otra evaluación' };
const EVAL_STATUS: Record<EvalStatus, string> = { pendiente: 'Pendiente', preparacion: 'Preparación', realizada: 'Realizada', calificada: 'Calificada' };
const PRIO: Record<Priority, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };
const ASG_STATUS = { pendiente: 'Pendiente', en_curso: 'En curso', completado: 'Completado', entregado: 'Entregado' } as const;

export async function plannerView(root: HTMLElement, _p: string[], q: URLSearchParams) {
  const c = await loadActive();
  if (!c) { root.append(pageTitle('Planificador'), emptyState('list', 'Nada que planificar todavía', 'Primero carga tu horario para registrar evaluaciones y trabajos.', h('a', { class: 'btn primary', href: '#/importar' }, 'Cargar nuevo Excel'))); return; }
  const tab = q.get('tab') === 'trabajos' ? 'trabajos' : 'evaluaciones';
  root.append(pageTitle('Planificador'),
    h('div', { class: 'tabs', role: 'tablist' }, [['evaluaciones', 'Evaluaciones'], ['trabajos', 'Trabajos']].map(([k, l]) => h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(tab === k), onClick: () => setQuery('tab', k) }, l))),
    h('div', { class: 'filters' }, subjectSelect(c.data.subjects, filter, (v) => { filter = v; void refresh(); })));
  root.append(tab === 'trabajos' ? assignmentsPanel(c, filter || undefined) : evaluationsPanel(c, filter || undefined));
}

const section = (title: string, nodes: Node[], emptyText: string) => h('section', null, h('h2', { class: 'section-title' }, title), nodes.length ? h('div', { class: 'stack' }, nodes) : h('div', { class: 'card soft' }, emptyText));

/* ---------------- Evaluaciones ---------------- */
export function evaluationsPanel(c: Ctx, subjectId?: string) {
  const today = todayISO(); const subj = new Map(c.data.subjects.map((s) => [s.id, s]));
  const list = c.data.evaluations.filter((e) => !subjectId || e.subjectId === subjectId);
  const by = (b: string) => list.filter((e) => evaluationBucket(e, today) === b);
  const card = (e: Evaluation) => {
    const sel = h('select', { 'aria-label': 'Estado de la evaluación', style: 'min-height:38px;border-radius:10px;border:1.5px solid var(--border);padding:2px 8px;background:#fff' }, Object.entries(EVAL_STATUS).map(([k, l]) => h('option', { value: k, selected: e.status === k }, l)));
    sel.addEventListener('change', async () => { await evaluations.put({ ...e, status: sel.value as EvalStatus, updatedAt: Date.now() }); void refresh(); });
    const bucket = evaluationBucket(e, today);
    return h('article', { class: 'card' },
      h('div', { class: 'row between' }, h('div', { class: 'row' }, badge(subj.get(e.subjectId)), h('strong', null, e.name)), h('span', { class: 'tag' + (bucket === 'vencida' ? ' bad' : '') }, bucket === 'vencida' ? 'Vencida' : EVAL_STATUS[e.status])),
      h('div', { class: 'soft' }, e.typeLabel, e.date ? ` · ${fmtLong(e.date)}${e.time ? ' · ' + e.time : ''}` : ' · Sin fecha', e.date && bucket !== 'realizada' ? ` · ${daysLabel(daysLeft(e.date, today)).replace('Vence', 'Es').replace('Venció', 'Fue')}` : ''),
      e.topics ? h('p', null, h('strong', null, 'Temario: '), e.topics) : null,
      h('div', { class: 'row small' }, e.weight !== null ? h('span', { class: 'tag' }, `Ponderación ${e.weight} %`) : null, e.grade !== null ? h('span', { class: 'tag' }, `Calificación ${e.grade}`) : null),
      e.observations ? h('p', { class: 'soft small' }, e.observations) : null,
      h('div', { class: 'row', style: 'margin-top:6px' }, sel, h('button', { class: 'btn sm', type: 'button', onClick: () => evaluationForm(c, e, subjectId) }, icon('pencil', 16), 'Editar'),
        h('button', { class: 'btn sm danger', type: 'button', onClick: async () => { if (await confirmDialog(`¿Eliminar la evaluación "${e.name}"?`, { danger: true, confirmLabel: 'Eliminar' })) { await evaluations.delete(e.id); void refresh(); } } }, icon('trash', 16), 'Eliminar')));
  };
  const asc = (a: Evaluation, b: Evaluation) => (a.date ?? '9999').localeCompare(b.date ?? '9999');
  const box = h('div', null);
  if (!list.length) box.append(emptyState('flag', 'Sin evaluaciones', 'Registra pruebas parciales, exámenes, seminarios y más.'));
  else box.append(section('Próximas', by('proxima').sort(asc).map(card), 'No tienes evaluaciones próximas.'), section('Vencidas (sin marcar como realizadas)', by('vencida').sort(asc).map(card), 'Ninguna vencida.'), section('Realizadas', by('realizada').sort((a, b) => asc(b, a)).map(card), 'Aún no hay evaluaciones realizadas.'));
  box.append(h('button', { class: 'btn fab primary', type: 'button', onClick: () => evaluationForm(c, null, subjectId) }, icon('plus', 20), 'Nueva evaluación'));
  return box;
}

function evaluationForm(c: Ctx, e: Evaluation | null, fixedSubject?: string) {
  const subjOpts = c.data.subjects.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }));
  formModal({
    title: e ? 'Editar evaluación' : 'Nueva evaluación',
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', value: e?.name ?? '', required: true },
      { name: 'subjectId', label: 'Asignatura', type: 'select', value: e?.subjectId ?? fixedSubject ?? subjOpts[0]?.value, options: subjOpts, required: true },
      { name: 'type', label: 'Tipo', type: 'select', value: e?.type ?? 'parcial', options: Object.entries(EVAL_TYPES).map(([value, label]) => ({ value, label })) },
      { name: 'custom', label: 'Nombre del tipo (solo si eliges "Otra evaluación")', type: 'text', value: e?.type === 'otra' ? e.typeLabel : '' },
      { name: 'date', label: 'Fecha', type: 'date', value: e?.date ?? '' }, { name: 'time', label: 'Hora', type: 'time', value: e?.time ?? '' },
      { name: 'topics', label: 'Contenido o temario', type: 'textarea', value: e?.topics ?? '', rows: 3 },
      { name: 'weight', label: 'Ponderación % (opcional)', type: 'number', value: e?.weight ?? '', min: 0, max: 100 },
      { name: 'grade', label: 'Calificación (opcional)', type: 'number', value: e?.grade ?? '', min: 0, help: 'Se guarda tal cual la escribes; la app no calcula notas finales.' },
      { name: 'status', label: 'Estado', type: 'select', value: e?.status ?? 'pendiente', options: Object.entries(EVAL_STATUS).map(([value, label]) => ({ value, label })) },
      { name: 'observations', label: 'Observaciones', type: 'textarea', value: e?.observations ?? '', rows: 2 },
    ],
    validate: (v) => (v.weight !== null && (v.weight < 0 || v.weight > 100) ? 'La ponderación debe estar entre 0 y 100.' : v.grade !== null && v.grade < 0 ? 'La calificación no puede ser negativa.' : null),
    onSubmit: async (v) => {
      const now = Date.now();
      const rec: Evaluation = { id: e?.id ?? uid('eva'), subjectId: v.subjectId, semesterId: c.sem.id, name: v.name, type: v.type, typeLabel: v.type === 'otra' && v.custom ? v.custom : EVAL_TYPES[v.type as EvalType], date: v.date || null, time: v.time, topics: v.topics, weight: v.weight, grade: v.grade, status: v.status, observations: v.observations, createdAt: e?.createdAt ?? now, updatedAt: now };
      await evaluations.put(rec); toast('Evaluación guardada'); void refresh();
    },
  });
}

/* ---------------- Trabajos ---------------- */
export function assignmentsPanel(c: Ctx, subjectId?: string) {
  const today = todayISO(); const subj = new Map(c.data.subjects.map((s) => [s.id, s]));
  const list = c.data.assignments.filter((a) => !subjectId || a.subjectId === subjectId);
  const asc = (a: Assignment, b: Assignment) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
  const card = (a: Assignment) => {
    const st = assignmentStatus(a, today); const left = daysLeft(a.dueDate, today); const prog = subtaskProgress(a);
    const tagCls = st === 'atrasado' ? 'bad' : isDueSoon(a, today) ? 'warn' : '';
    return h('article', { class: 'card' },
      h('div', { class: 'row between' }, h('div', { class: 'row' }, badge(subj.get(a.subjectId)), h('strong', null, a.title)),
        h('span', { class: 'tag ' + tagCls }, st === 'atrasado' ? icon('alert', 14) : null, st === 'atrasado' ? ' Atrasado' : ASG_STATUS[st as keyof typeof ASG_STATUS])),
      h('div', { class: 'soft' }, a.startDate ? `Inicio: ${fmtLong(a.startDate)} · ` : '', a.dueDate ? `Entrega: ${fmtLong(a.dueDate)}` : 'Sin fecha límite'),
      st !== 'entregado' && st !== 'completado' ? h('div', null, h('strong', null, daysLabel(left))) : a.deliveredDate ? h('div', { class: 'soft' }, 'Entregado el ' + fmtLong(a.deliveredDate)) : null,
      h('div', { class: 'row small' }, h('span', { class: 'tag' + (a.priority === 'alta' ? ' bad' : '') }, 'Prioridad ' + PRIO[a.priority]), a.estimatedHours !== null ? h('span', { class: 'tag' }, `Estimado ${a.estimatedHours} h`) : null, a.spentHours !== null ? h('span', { class: 'tag' }, `Dedicado ${a.spentHours} h`) : null),
      a.description ? h('p', null, a.description) : null,
      prog !== null ? h('div', null, h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': prog, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Progreso de subtareas' }, h('span', { style: `width:${prog}%` })), h('div', { class: 'soft small' }, `Progreso: ${prog} %`)) : null,
      a.subtasks.length ? h('details', null, h('summary', null, `Subtareas (${a.subtasks.filter((s) => s.done).length}/${a.subtasks.length})`), h('ul', { class: 'plain' }, a.subtasks.map((s) => { const cb = h('input', { type: 'checkbox', checked: s.done, style: 'width:22px;height:22px' }); cb.addEventListener('change', async () => { s.done = cb.checked; await assignments.put({ ...a, updatedAt: Date.now() }); void refresh(); }); return h('li', null, h('label', { class: 'row', style: 'min-height:40px' }, cb, s.title)); }))) : null,
      a.links.length ? h('ul', { class: 'plain small' }, a.links.map((l) => h('li', null, /^https?:\/\//i.test(l) ? h('a', { href: l, target: '_blank', rel: 'noopener noreferrer' }, l) : l))) : null,
      a.observations ? h('p', { class: 'soft small' }, a.observations) : null,
      h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { class: 'btn sm', type: 'button', onClick: () => assignmentForm(c, a, subjectId) }, icon('pencil', 16), 'Editar'),
        h('button', { class: 'btn sm danger', type: 'button', onClick: async () => { if (await confirmDialog(`¿Eliminar el trabajo "${a.title}"?`, { danger: true, confirmLabel: 'Eliminar' })) { await assignments.delete(a.id); void refresh(); } } }, icon('trash', 16), 'Eliminar')));
  };
  const late = list.filter((a) => assignmentStatus(a, today) === 'atrasado').sort(asc);
  const soon = list.filter((a) => isDueSoon(a, today)).sort(asc);
  const active = list.filter((a) => ['pendiente', 'en_curso'].includes(assignmentStatus(a, today)) && !soon.includes(a)).sort(asc);
  const fin = list.filter((a) => ['completado', 'entregado'].includes(a.status)).sort((a, b) => asc(b, a));
  const box = h('div', null);
  if (!list.length) box.append(emptyState('list', 'Sin trabajos', 'Registra trabajos con fecha de inicio y de entrega, y divídelos en subtareas.'));
  else box.append(section('Atrasados', late.map(card), 'Ninguno atrasado.'), section('Próximos a vencer (7 días)', soon.map(card), 'Nada vence esta semana.'), section('En curso y pendientes', active.map(card), 'Sin otros trabajos pendientes.'), section('Completados y entregados', fin.map(card), 'Aún no hay trabajos terminados.'));
  box.append(h('button', { class: 'btn fab primary', type: 'button', onClick: () => assignmentForm(c, null, subjectId) }, icon('plus', 20), 'Nuevo trabajo'));
  return box;
}

const STAGES = ['Investigación', 'Planificación', 'Desarrollo', 'Revisión', 'Entrega'];
function subtasksEditor(initial: Subtask[]) {
  let items = initial.map((s) => ({ ...s }));
  const list = h('div', null);
  const draw = () => {
    list.textContent = '';
    items.forEach((s, i) => {
      const cb = h('input', { type: 'checkbox', checked: s.done, 'aria-label': 'Completada', style: 'width:22px;height:22px;flex:none', onChange: () => { s.done = cb.checked; } });
      const tx = h('input', { type: 'text', value: s.title, 'aria-label': `Subtarea ${i + 1}`, style: 'flex:1;min-height:42px;border-radius:10px;border:1.5px solid var(--border);padding:4px 10px', onInput: () => { s.title = tx.value; } });
      list.append(h('div', { class: 'row', style: 'flex-wrap:nowrap;margin-bottom:6px' }, cb, tx, h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Quitar subtarea ${i + 1}`, onClick: () => { items.splice(i, 1); draw(); } }, icon('x', 18))));
    });
  };
  draw();
  const el = h('div', null, list, h('div', { class: 'row' },
    h('button', { class: 'btn sm', type: 'button', onClick: () => { items.push({ id: uid('st'), title: '', done: false }); draw(); (list.lastElementChild?.querySelector('input[type=text]') as HTMLElement)?.focus(); } }, icon('plus', 16), 'Añadir subtarea'),
    h('button', { class: 'btn sm ghost', type: 'button', onClick: () => { for (const t of STAGES) if (!items.some((x) => x.title === t)) items.push({ id: uid('st'), title: t, done: false }); draw(); } }, 'Añadir etapas sugeridas')));
  return { el, get: () => items.filter((s) => s.title.trim()).map((s) => ({ ...s, title: s.title.trim() })) };
}

function assignmentForm(c: Ctx, a: Assignment | null, fixedSubject?: string) {
  const subjOpts = c.data.subjects.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }));
  const ed = subtasksEditor(a?.subtasks ?? []);
  formModal({
    title: a ? 'Editar trabajo' : 'Nuevo trabajo',
    fields: [
      { name: 'title', label: 'Título', type: 'text', value: a?.title ?? '', required: true },
      { name: 'subjectId', label: 'Asignatura', type: 'select', value: a?.subjectId ?? fixedSubject ?? subjOpts[0]?.value, options: subjOpts, required: true },
      { name: 'description', label: 'Descripción', type: 'textarea', value: a?.description ?? '', rows: 3 },
      { name: 'startDate', label: 'Fecha de inicio', type: 'date', value: a?.startDate ?? '' },
      { name: 'dueDate', label: 'Fecha límite de entrega', type: 'date', value: a?.dueDate ?? '' },
      { name: 'plannedFinish', label: 'Mi fecha prevista de finalización (opcional)', type: 'date', value: a?.plannedFinish ?? '', help: 'Es independiente de la fecha límite oficial.' },
      { name: 'priority', label: 'Prioridad', type: 'select', value: a?.priority ?? 'media', options: Object.entries(PRIO).map(([value, label]) => ({ value, label })) },
      { name: 'status', label: 'Estado', type: 'select', value: a?.status ?? 'pendiente', options: Object.entries(ASG_STATUS).map(([value, label]) => ({ value, label })), help: '"Atrasado" se calcula solo cuando pasa la fecha límite.' },
      { name: 'estimatedHours', label: 'Tiempo estimado (horas, opcional)', type: 'number', value: a?.estimatedHours ?? '', min: 0 },
      { name: 'spentHours', label: 'Tiempo dedicado (horas, opcional)', type: 'number', value: a?.spentHours ?? '', min: 0 },
      { name: 'links', label: 'Recursos o enlaces (uno por línea)', type: 'textarea', value: a?.links.join('\n') ?? '', rows: 3 },
      { name: 'deliveredDate', label: 'Fecha real de entrega (opcional)', type: 'date', value: a?.deliveredDate ?? '' },
      { name: 'observations', label: 'Observaciones', type: 'textarea', value: a?.observations ?? '', rows: 2 },
      { name: 'subtasks', label: 'Subtareas / etapas', type: 'custom', el: ed.el, get: ed.get },
    ],
    validate: (v) => (v.startDate && v.dueDate && v.dueDate < v.startDate ? 'La fecha límite no puede ser anterior a la fecha de inicio.' : null),
    onSubmit: async (v) => {
      const now = Date.now();
      const rec: Assignment = { id: a?.id ?? uid('asg'), subjectId: v.subjectId, semesterId: c.sem.id, title: v.title, description: v.description, startDate: v.startDate || null, dueDate: v.dueDate || null, plannedFinish: v.plannedFinish || null, priority: v.priority, status: v.status,
        estimatedHours: v.estimatedHours, spentHours: v.spentHours, links: String(v.links).split('\n').map((x: string) => x.trim()).filter(Boolean), observations: v.observations,
        deliveredDate: v.deliveredDate || (v.status === 'entregado' ? todayISO() : null), subtasks: v.subtasks, createdAt: a?.createdAt ?? now, updatedAt: now };
      await assignments.put(rec); toast('Trabajo guardado'); void refresh();
    },
  });
}
