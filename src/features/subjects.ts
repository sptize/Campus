import { h } from '../ui/h';
import { icon } from '../ui/icons';
import { loadActive, type Ctx } from '../app/context';
import { refresh, setQuery, go } from '../app/router';
import { badge, emptyState, pageTitle, profLine, profLabel } from '../ui/parts';
import { formModal, confirmDialog, toast, reportError } from '../ui/modal';
import { subjects, sessions, notes, objectives, evaluations, assignments, transact, uid } from '../db/idb';
import type { Note, Objective, Subject, Priority } from '../db/types';
import { fmtLong, fmtShort, todayISO } from '../services/dates';
import { assignmentStatus, evaluationBucket, nextSession, nowMinutes, objectiveProgress, sessionTimes } from '../services/status';
import { evaluationsPanel, assignmentsPanel } from './planner';

export async function subjectsView(root: HTMLElement) {
  const c = await loadActive();
  if (!c) { root.append(pageTitle('Asignaturas'), emptyState('book', 'Sin asignaturas', 'Cuando cargues tu horario, tus asignaturas aparecerán aquí.', h('a', { class: 'btn primary', href: '#/importar' }, 'Cargar nuevo Excel'))); return; }
  const { data, sem } = c; const today = todayISO();
  root.append(pageTitle('Asignaturas'));
  if (!data.subjects.length) root.append(emptyState('book', 'Este semestre no tiene asignaturas', 'Añade una a mano o carga el Excel del horario.'));
  const list = h('div', { class: 'stack' });
  for (const s of data.subjects) {
    const ns = nextSession(data.sessions.filter((x) => x.subjectId === s.id), sem, today, nowMinutes());
    const pend = data.evaluations.filter((e) => e.subjectId === s.id && evaluationBucket(e, today) !== 'realizada').length;
    const tr = data.assignments.filter((a) => a.subjectId === s.id && !['completado', 'entregado'].includes(assignmentStatus(a, today))).length;
    const p = objectiveProgress(data.objectives.filter((o) => o.subjectId === s.id));
    list.append(h('a', { class: 'card', href: '#/asignaturas/' + encodeURIComponent(s.id), style: 'display:block;text-decoration:none;color:inherit' },
      h('div', { class: 'row' }, badge(s), h('strong', { class: 'grow' }, s.name), icon('right')),
      h('div', { class: 'soft small' }, 'Profesor: ' + profLabel(s)),
      h('div', { class: 'row small', style: 'margin-top:6px' }, ns ? h('span', { class: 'tag' }, 'Próxima: ' + fmtShort(ns.date)) : null, pend ? h('span', { class: 'tag' }, `${pend} evaluación${pend > 1 ? 'es' : ''}`) : null, tr ? h('span', { class: 'tag' }, `${tr} trabajo${tr > 1 ? 's' : ''}`) : null, p.total ? h('span', { class: 'tag' }, `Objetivos ${p.done}/${p.total}`) : null)));
  }
  root.append(list, h('button', { class: 'btn fab primary', type: 'button', onClick: () => subjectForm(c, null) }, icon('plus', 20), 'Nueva asignatura'));
}

function subjectForm(c: Ctx, s: Subject | null) {
  formModal({
    title: s ? 'Editar asignatura' : 'Nueva asignatura',
    fields: [{ name: 'code', label: 'Símbolo o código', type: 'text', value: s?.code ?? '', required: true }, { name: 'name', label: 'Nombre', type: 'text', value: s?.name ?? '', required: true }, { name: 'professor', label: 'Profesor (opcional)', type: 'text', value: s?.professor ?? '' }],
    validate: (v) => (c.data.subjects.some((x) => x.id !== s?.id && x.code.toLowerCase() === v.code.toLowerCase()) ? 'Ya existe una asignatura con ese símbolo en este semestre.' : null),
    onSubmit: async (v) => {
      const rec: Subject = s ? { ...s, code: v.code, name: v.name, professor: v.professor || null, edited: true }
        : { id: uid('sub'), semesterId: c.sem.id, code: v.code, name: v.name, professor: v.professor || null, category: null, colorIndex: c.data.subjects.length, observations: '', source: 'manual', edited: true, createdAt: Date.now() };
      await subjects.put(rec); toast('Asignatura guardada'); void refresh();
    },
  });
}

const TABS = [['resumen', 'Resumen'], ['notas', 'Mis notas'], ['objetivos', 'Objetivos'], ['evaluaciones', 'Evaluaciones'], ['trabajos', 'Trabajos']] as const;

export async function subjectDetail(root: HTMLElement, params: string[], q: URLSearchParams) {
  const c = await loadActive(); const id = decodeURIComponent(params[0]);
  const s = c?.data.subjects.find((x) => x.id === id);
  if (!c || !s) { root.append(emptyState('book', 'Asignatura no encontrada', 'Puede pertenecer a otro semestre.', h('a', { class: 'btn', href: '#/asignaturas' }, 'Volver'))); return; }
  const tab = q.get('tab') ?? 'resumen';
  root.append(h('a', { href: '#/asignaturas', class: 'btn sm ghost', style: 'margin-bottom:8px' }, icon('left', 16), 'Asignaturas'),
    h('div', { class: 'row', style: 'margin:6px 0 10px' }, badge(s), h('h2', { class: 'grow' }, s.name)),
    h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, l]) => h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(tab === k), onClick: () => setQuery('tab', k) }, l))));
  const done = () => void refresh();
  if (tab === 'resumen') resumen(root, c, s, done);
  else if (tab === 'notas') await notasTab(root, c, s, q);
  else if (tab === 'objetivos') objetivosTab(root, c, s);
  else if (tab === 'evaluaciones') root.append(evaluationsPanel(c, s.id));
  else root.append(assignmentsPanel(c, s.id));
}

function resumen(root: HTMLElement, c: Ctx, s: Subject, done: () => void) {
  const ses = c.data.sessions.filter((x) => x.subjectId === s.id).sort((a, b) => a.date.localeCompare(b.date));
  const obs = h('textarea', { rows: 4, 'aria-label': 'Observaciones adicionales', placeholder: 'Observaciones adicionales…' }); obs.value = s.observations;
  const stat = h('span', { class: 'savestate', 'aria-live': 'polite' }, '');
  let t: any; obs.addEventListener('input', () => { stat.textContent = 'Guardando…'; clearTimeout(t); t = setTimeout(async () => { try { s.observations = obs.value; await subjects.put({ ...s, observations: obs.value }); stat.textContent = 'Guardado'; } catch (e) { stat.textContent = 'Error al guardar'; reportError(e, 'No se pudieron guardar las observaciones'); } }, 600); });
  root.append(h('div', { class: 'stack' },
    h('div', { class: 'card' }, h('h3', null, 'Datos'), h('p', null, 'Símbolo: ', h('strong', null, s.code)), h('p', null, profLine(s, done)), c.sem.room ? h('p', null, 'Aula: ', h('strong', null, c.sem.room)) : null,
      s.source === 'import' ? h('p', { class: 'soft small' }, 'Importada del Excel. Si editas algo, se conserva al recargar el archivo.') : h('p', { class: 'soft small' }, 'Creada manualmente.'),
      h('button', { class: 'btn sm', type: 'button', onClick: () => subjectForm(c, s) }, icon('pencil', 16), 'Editar datos')),
    h('div', { class: 'card' }, h('h3', null, `Clases (${ses.length})`),
      ses.length ? h('details', null, h('summary', null, 'Ver fechas y horarios'), h('ul', { class: 'plain' }, ses.map((x) => { const t2 = sessionTimes(x, c.sem); return h('li', { style: 'padding:3px 0' }, `${fmtLong(x.date)} · ${t2.start}–${t2.end}${x.partial ? ' · ∆ Prueba parcial' : ''}`); }))) : h('p', { class: 'soft' }, 'Sin clases registradas.')),
    h('div', { class: 'card' }, h('h3', null, 'Observaciones'), obs, stat),
    h('button', { class: 'btn danger', type: 'button', onClick: async () => {
      if (!(await confirmDialog(`¿Eliminar "${s.name}" con todas sus notas, objetivos, evaluaciones, trabajos y clases? No se puede deshacer.`, { danger: true, confirmLabel: 'Eliminar todo' }))) return;
      await transact([subjects, sessions, notes, objectives, evaluations, assignments], async () => {
        for (const t of [sessions, notes, objectives, evaluations, assignments] as const) { const rows = await (t as any).where('subjectId', s.id); await (t as any).bulkDelete(rows.map((r: any) => r.id)); }
        await subjects.delete(s.id);
      });
      toast('Asignatura eliminada'); go('#/asignaturas');
    } }, icon('trash', 18), 'Eliminar asignatura')));
}

/* ---------- Mis notas (autoguardado con estado visible) ---------- */
async function notasTab(root: HTMLElement, c: Ctx, s: Subject, q: URLSearchParams) {
  const all = (await notes.where('subjectId', s.id)).sort((a, b) => b.updatedAt - a.updatedAt);
  const openId = q.get('nota');
  if (openId) { const n = all.find((x) => x.id === openId); if (n) { noteEditor(root, n); return; } }
  root.append(h('p', { class: 'soft' }, 'Escribe notas extensas por asignatura. Se guardan solas en este dispositivo y no se tocan al cargar un Excel nuevo.'));
  if (!all.length) root.append(emptyState('notebook', 'Aún no tienes notas', 'Crea la primera nota de esta asignatura.'));
  for (const n of all) root.append(h('a', { class: 'card', href: `#/asignaturas/${encodeURIComponent(s.id)}?tab=notas&nota=${n.id}`, style: 'display:block;text-decoration:none;color:inherit;margin-bottom:8px' },
    h('strong', null, n.title || 'Sin título'), h('div', { class: 'soft small' }, new Date(n.updatedAt).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })), h('div', { class: 'soft' }, n.body.slice(0, 120) || 'Nota vacía')));
  root.append(h('button', { class: 'btn fab primary', type: 'button', onClick: async () => {
    const n: Note = { id: uid('not'), subjectId: s.id, semesterId: c.sem.id, title: '', body: '', createdAt: Date.now(), updatedAt: Date.now() };
    try { await notes.put(n); setQuery('nota', n.id); } catch (e) { reportError(e, 'No se pudo crear la nota'); }
  } }, icon('plus', 20), 'Nueva nota'));
}

function noteEditor(root: HTMLElement, n: Note) {
  const title = h('input', { type: 'text', 'aria-label': 'Título de la nota', placeholder: 'Título (opcional)', style: 'width:100%;min-height:46px;border-radius:12px;border:1.5px solid var(--border);padding:8px 12px;font-weight:700' }); title.value = n.title;
  const body = h('textarea', { 'aria-label': 'Texto de la nota', rows: 14, placeholder: 'Escribe aquí…', style: 'width:100%;border-radius:12px;border:1.5px solid var(--border);padding:10px 12px;margin-top:8px;resize:vertical' }); body.value = n.body;
  const stat = h('span', { class: 'savestate', 'aria-live': 'polite', id: 'saveState' }, 'Guardado');
  let dirty = false; let timer: any;
  const save = async () => {
    clearTimeout(timer); if (!dirty) return;
    stat.textContent = 'Guardando…';
    try { n.title = title.value; n.body = body.value; n.updatedAt = Date.now(); await notes.put({ ...n }); dirty = false; stat.textContent = 'Guardado ' + new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { stat.textContent = 'No se pudo guardar. Reintentando al seguir escribiendo.'; reportError(e, 'No se pudo guardar la nota'); }
  };
  const onInput = () => { dirty = true; stat.textContent = 'Sin guardar…'; clearTimeout(timer); timer = setTimeout(save, 700); };
  title.addEventListener('input', onInput); body.addEventListener('input', onInput);
  const flush = () => { if (dirty) void save(); };
  window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  const guard = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', guard);
  const back = async () => { await save(); window.removeEventListener('beforeunload', guard); window.removeEventListener('pagehide', flush); setQuery('nota', ''); };
  root.append(h('div', { class: 'stack' },
    h('div', { class: 'row between' }, h('button', { class: 'btn sm ghost', type: 'button', onClick: back }, icon('left', 16), 'Volver a las notas'), stat),
    h('div', null, title, body),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onClick: async () => { dirty = true; await save(); toast('Nota guardada'); } }, icon('check', 18), 'Guardar ahora'),
      h('button', { class: 'btn danger', type: 'button', onClick: async () => { if (await confirmDialog('¿Eliminar esta nota?', { danger: true, confirmLabel: 'Eliminar' })) { dirty = false; window.removeEventListener('beforeunload', guard); await notes.delete(n.id); toast('Nota eliminada'); setQuery('nota', ''); } } }, icon('trash', 18), 'Eliminar')),
    h('p', { class: 'soft small' }, `Creada el ${new Date(n.createdAt).toLocaleDateString('es', { dateStyle: 'long' })}.`)));
}

/* ---------- Objetivos ---------- */
const PRIO: Record<Priority, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };
const OSTAT = { pendiente: 'Pendiente', en_curso: 'En curso', completado: 'Completado' } as const;

function objetivosTab(root: HTMLElement, c: Ctx, s: Subject) {
  const list = c.data.objectives.filter((o) => o.subjectId === s.id);
  const p = objectiveProgress(list);
  root.append(h('div', { class: 'card' }, h('h3', null, 'Progreso de objetivos'),
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': p.pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Progreso de objetivos' }, h('span', { style: `width:${p.pct}%` })),
    h('p', { class: 'soft' }, p.total ? `${p.done} de ${p.total} completados (${p.pct} %). Un objetivo completado no es una calificación.` : 'Aún no hay objetivos.')));
  for (const [scope, label] of [['general', 'Objetivos generales'], ['especifico', 'Objetivos específicos']] as const) {
    const items = list.filter((o) => o.scope === scope);
    root.append(h('h2', { class: 'section-title' }, label));
    if (!items.length) root.append(h('div', { class: 'card soft' }, 'Ninguno todavía.'));
    for (const o of items) {
      const sel = h('select', { 'aria-label': 'Estado del objetivo', style: 'min-height:38px;border-radius:10px;border:1.5px solid var(--border);padding:2px 8px;background:#fff' }, Object.entries(OSTAT).map(([k, l]) => h('option', { value: k, selected: o.status === k }, l)));
      sel.addEventListener('change', async () => { await objectives.put({ ...o, status: sel.value as Objective['status'], updatedAt: Date.now() }); void refresh(); });
      const ev = o.evaluationId ? c.data.evaluations.find((e) => e.id === o.evaluationId) : null; const as = o.assignmentId ? c.data.assignments.find((a) => a.id === o.assignmentId) : null;
      root.append(h('article', { class: 'card', style: 'margin-bottom:8px' },
        h('div', { class: 'row between' }, h('strong', null, (o.status === 'completado' ? '✓ ' : '') + o.title), h('span', { class: 'tag' + (o.priority === 'alta' ? ' bad' : '') }, 'Prioridad ' + PRIO[o.priority])),
        o.description ? h('p', null, o.description) : null,
        h('div', { class: 'soft small' }, [o.dueDate ? 'Previsto: ' + fmtLong(o.dueDate) : null, ev ? 'Evaluación: ' + ev.name : null, as ? 'Trabajo: ' + as.title : null].filter(Boolean).join(' · ')), o.observations ? h('p', { class: 'soft small' }, o.observations) : null,
        h('div', { class: 'row', style: 'margin-top:6px' }, sel, h('button', { class: 'btn sm', type: 'button', onClick: () => objectiveForm(c, s, o) }, icon('pencil', 16), 'Editar'),
          h('button', { class: 'btn sm danger', type: 'button', onClick: async () => { if (await confirmDialog('¿Eliminar este objetivo?', { danger: true, confirmLabel: 'Eliminar' })) { await objectives.delete(o.id); void refresh(); } } }, icon('trash', 16), 'Eliminar'))));
    }
  }
  root.append(h('button', { class: 'btn fab primary', type: 'button', onClick: () => objectiveForm(c, s, null) }, icon('plus', 20), 'Nuevo objetivo'));
}

function objectiveForm(c: Ctx, s: Subject, o: Objective | null) {
  const evs = c.data.evaluations.filter((e) => e.subjectId === s.id), ass = c.data.assignments.filter((a) => a.subjectId === s.id);
  formModal({
    title: o ? 'Editar objetivo' : 'Nuevo objetivo',
    fields: [
      { name: 'title', label: 'Título', type: 'text', value: o?.title ?? '', required: true },
      { name: 'scope', label: 'Tipo', type: 'select', value: o?.scope ?? 'especifico', options: [{ value: 'general', label: 'General' }, { value: 'especifico', label: 'Específico' }] },
      { name: 'description', label: 'Descripción', type: 'textarea', value: o?.description ?? '', rows: 3 },
      { name: 'dueDate', label: 'Fecha prevista (opcional)', type: 'date', value: o?.dueDate ?? '' },
      { name: 'priority', label: 'Prioridad', type: 'select', value: o?.priority ?? 'media', options: Object.entries(PRIO).map(([value, label]) => ({ value, label })) },
      { name: 'status', label: 'Estado', type: 'select', value: o?.status ?? 'pendiente', options: Object.entries(OSTAT).map(([value, label]) => ({ value, label })) },
      { name: 'evaluationId', label: 'Evaluación relacionada (opcional)', type: 'select', value: o?.evaluationId ?? '', options: [{ value: '', label: '— Ninguna —' }, ...evs.map((e) => ({ value: e.id, label: e.name }))] },
      { name: 'assignmentId', label: 'Trabajo relacionado (opcional)', type: 'select', value: o?.assignmentId ?? '', options: [{ value: '', label: '— Ninguno —' }, ...ass.map((a) => ({ value: a.id, label: a.title }))] },
      { name: 'observations', label: 'Observaciones', type: 'textarea', value: o?.observations ?? '', rows: 2 },
    ],
    onSubmit: async (v) => {
      const now = Date.now();
      const rec: Objective = { id: o?.id ?? uid('obj'), subjectId: s.id, semesterId: c.sem.id, scope: v.scope, title: v.title, description: v.description, dueDate: v.dueDate || null, priority: v.priority, status: v.status, observations: v.observations, evaluationId: v.evaluationId || null, assignmentId: v.assignmentId || null, createdAt: o?.createdAt ?? now, updatedAt: now };
      await objectives.put(rec); toast('Objetivo guardado'); void refresh();
    },
  });
}
