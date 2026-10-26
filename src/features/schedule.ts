import { h } from '../ui/h';
import { icon } from '../ui/icons';
import { loadActive, type Ctx } from '../app/context';
import { refresh } from '../app/router';
import { badge, emptyState, pageTitle, sessionCard, subjectSelect } from '../ui/parts';
import { formModal, confirmDialog, toast } from '../ui/modal';
import { sessions, events as eventsTable, uid } from '../db/idb';
import type { Session, SpecialEvent } from '../db/types';
import { CAL_LABEL, CAL_OFFICIAL, collectEvents, type CalType } from '../services/calendar';
import { addDays, daysBetween, fmtLong, fmtMonth, fmtShort, fromISO, isISO, startOfWeek, todayISO, toISO, weekdayName } from '../services/dates';
import { nextSession, nowMinutes, sessionTimes, subjectColor } from '../services/status';

type Mode = 'semana' | 'dia' | 'lista' | 'mes';
const st = { mode: 'semana' as Mode, date: todayISO(), filter: '', types: new Set<CalType>(Object.keys(CAL_LABEL) as CalType[]), sel: null as string | null };
const MODES: [Mode, string][] = [['semana', 'Semana'], ['dia', 'Día'], ['lista', 'Lista'], ['mes', 'Mes']];

export async function scheduleView(root: HTMLElement) {
  const c = await loadActive();
  if (!c) {
    root.append(pageTitle('Horario'), emptyState('calendar', 'Sin horario todavía', 'Carga el Excel de tu semestre para ver tus clases aquí.', h('a', { class: 'btn primary', href: '#/importar' }, icon('sheet', 18), 'Cargar nuevo Excel')));
    return;
  }
  const { sem, data } = c;
  root.append(pageTitle('Horario', h('a', { class: 'btn sm primary', href: '#/importar' }, icon('sheet', 16), 'Cargar nuevo Excel')));
  root.append(h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Vista del horario' }, MODES.map(([m, l]) => h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(st.mode === m), onClick: () => { st.mode = m; void refresh(false); } }, l))));
  root.append(h('div', { class: 'filters' }, subjectSelect(data.subjects, st.filter, (v) => { st.filter = v; void refresh(); })));

  const sess = data.sessions.filter((s) => !st.filter || s.subjectId === st.filter);
  const subj = new Map(data.subjects.map((s) => [s.id, s]));
  const today = todayISO();
  const nextS = nextSession(data.sessions, sem, today, nowMinutes());

  const nav = (label: string, step: number) => h('div', { class: 'nav' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Anterior', onClick: () => { st.date = st.mode === 'mes' ? toISO(new Date(fromISO(st.date).getFullYear(), fromISO(st.date).getMonth() - 1, 1, 12)) : addDays(st.date, -step); void refresh(false); } }, icon('left')),
    h('div', { class: 'label' }, label),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Siguiente', onClick: () => { st.date = st.mode === 'mes' ? toISO(new Date(fromISO(st.date).getFullYear(), fromISO(st.date).getMonth() + 1, 1, 12)) : addDays(st.date, step); void refresh(false); } }, icon('right')));
  const jump = h('div', { class: 'row', style: 'margin-bottom:8px' },
    h('button', { class: 'btn sm', type: 'button', onClick: () => { st.date = today; st.sel = today; void refresh(false); } }, 'Hoy'),
    nextS ? h('button', { class: 'btn sm', type: 'button', onClick: () => { st.date = nextS.date; st.sel = nextS.date; void refresh(false); } }, 'Ir a la próxima clase') : null);

  const dayBlock = (iso: string) => {
    const box = h('section', { class: 'stack' });
    const items = sess.filter((s) => s.date === iso).sort((a, b) => a.turnStart - b.turnStart);
    const evs = data.events.filter((e) => e.startDate && iso >= e.startDate && iso <= (e.endDate ?? e.startDate));
    const wk = items.find((s) => s.week)?.week;
    box.append(h('div', { class: 'dayhead' }, h('h3', null, fmtLong(iso), iso === today ? h('span', { class: 'today-mark' }, ' · Hoy') : null), wk ? h('span', { class: 'tag' }, `Semana lectiva ${wk}`) : null));
    for (const e of evs) box.append(eventCard(e, c));
    for (const s of items) box.append(sessionCard(s, subj.get(s.subjectId ?? ''), sem, { onEdit: () => sessionForm(c, s), refresh: () => void refresh() }));
    if (!items.length && !evs.length) box.append(h('div', { class: 'card soft' }, 'Sin clases'));
    return box;
  };

  if (st.mode === 'semana') {
    const mon = startOfWeek(st.date);
    root.append(nav(`${fmtShort(mon)} – ${fmtShort(addDays(mon, 6))}`, 7), jump);
    for (let i = 0; i < 7; i++) {
      const iso = addDays(mon, i);
      const any = sess.some((s) => s.date === iso) || data.events.some((e) => e.startDate && iso >= e.startDate && iso <= (e.endDate ?? e.startDate));
      if (i < 5 || any) root.append(dayBlock(iso));
    }
    if (!sess.some((s) => s.date >= mon && s.date <= addDays(mon, 6))) root.append(h('div', { class: 'info', style: 'margin-top:12px' }, 'En esta semana no hay clases en tu horario. Usa "Ir a la próxima clase" o la vista Lista para ver todas las semanas.'));
  } else if (st.mode === 'dia') {
    root.append(nav(weekdayName(st.date) + ' ' + fmtShort(st.date), 1), jump, dayBlock(st.date));
  } else if (st.mode === 'lista') {
    root.append(listMode(c, sess, today));
  } else {
    root.append(monthMode(c, today, nav));
  }

  // Datos pendientes de confirmar (nada se coloca en una fecha inventada)
  const pendEvents = data.events.filter((e) => !e.startDate);
  const pendSess = data.sessions.filter((s) => !s.subjectId);
  if (pendEvents.length || pendSess.length) {
    root.append(h('h2', { class: 'section-title' }, 'Pendiente de confirmar'));
    for (const e of pendEvents) root.append(eventCard(e, c));
    for (const s of pendSess) root.append(sessionCard(s, undefined, sem, { date: true, onEdit: () => sessionForm(c, s) }));
  }
  root.append(h('button', { class: 'btn fab primary', type: 'button', onClick: () => sessionForm(c, null) }, icon('plus', 20), 'Añadir clase'));
}

function eventCard(e: SpecialEvent, c: Ctx) {
  const range = e.startDate ? (e.endDate ? `${fmtShort(e.startDate)} – ${fmtShort(e.endDate)}` : fmtLong(e.startDate)) : 'Sin fecha en el Excel';
  const label = e.kind === 'receso' ? 'Receso docente' : e.kind.startsWith('examen') ? 'Período de exámenes' : 'Evento académico';
  return h('article', { class: 'info' + (e.startDate ? '' : ' warn') },
    h('div', { class: 'row between' }, h('div', null, h('span', { class: 'tag official' }, 'Oficial · ' + label), h('h3', { style: 'margin-top:6px' }, e.title), h('div', { class: 'soft' }, range, e.week ? ` · Semana ${e.week}` : '')),
      h('button', { class: 'btn sm', type: 'button', onClick: () => eventForm(c, e) }, e.startDate ? 'Editar fecha' : 'Asignar fecha')));
}
function eventForm(c: Ctx, e: SpecialEvent) {
  formModal({
    title: e.startDate ? 'Editar fecha del evento' : 'Asignar fecha', intro: e.title,
    fields: [{ name: 'start', label: 'Fecha de inicio', type: 'date', value: e.startDate ?? '' }, { name: 'end', label: 'Fecha de fin (opcional)', type: 'date', value: e.endDate ?? '' }],
    validate: (v) => (v.end && v.start && v.end < v.start ? 'La fecha de fin no puede ser anterior a la de inicio.' : null),
    onSubmit: async (v) => { await eventsTable.put({ ...e, startDate: v.start || null, endDate: v.end || null, edited: true }); toast('Evento actualizado'); void refresh(); },
  });
}

export function sessionForm(c: Ctx, s: Session | null) {
  const { sem, data } = c;
  const opts = [{ value: '', label: '— Sin asignar —' }, ...data.subjects.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))];
  const dlg = formModal({
    title: s ? 'Editar clase' : 'Añadir clase', submitLabel: 'Guardar',
    intro: s ? 'Los cambios manuales se conservan si vuelves a cargar el Excel.' : undefined,
    fields: [
      { name: 'subjectId', label: 'Asignatura', type: 'select', options: opts, value: s?.subjectId ?? '', required: true },
      { name: 'date', label: 'Fecha', type: 'date', value: s?.date ?? st.date, required: true },
      { name: 'turnStart', label: 'Turno inicial', type: 'number', value: s?.turnStart ?? 1, required: true, min: 1, step: 1 },
      { name: 'turnEnd', label: 'Turno final', type: 'number', value: s?.turnEnd ?? s?.turnStart ?? 2, required: true, min: 1, step: 1, help: `Cada turno dura ${sem.turnMinutes} min desde las ${sem.startTime}.` },
      { name: 'room', label: 'Aula', type: 'text', value: s?.room ?? sem.room },
    ],
    validate: (v) => (!isISO(v.date) ? 'Fecha inválida.' : v.turnEnd < v.turnStart ? 'El turno final no puede ser menor que el inicial.' : !Number.isInteger(v.turnStart) || !Number.isInteger(v.turnEnd) ? 'Los turnos deben ser números enteros.' : null),
    onSubmit: async (v) => {
      const sub = data.subjects.find((x) => x.id === v.subjectId);
      const rec: Session = s ? { ...s, subjectId: v.subjectId, symbol: sub?.code ?? s.symbol, date: v.date, turnStart: v.turnStart, turnEnd: v.turnEnd, room: v.room, edited: true }
        : { id: uid('ses'), semesterId: sem.id, subjectId: v.subjectId, symbol: sub?.code ?? '', date: v.date, week: null, turnStart: v.turnStart, turnEnd: v.turnEnd, room: v.room, partial: false, source: 'manual', edited: true };
      if (s && (s.date !== rec.date || s.turnStart !== rec.turnStart || s.id !== rec.id)) { /* la clave no depende de la fecha: se conserva el id */ }
      await sessions.put(rec); toast('Clase guardada'); void refresh();
    },
  });
  if (s) {
    const del = h('button', { class: 'btn danger sm', type: 'button', onClick: async () => { if (await confirmDialog('¿Eliminar esta clase del horario? Si la quitas y luego recargas el Excel, volverá a aparecer.', { danger: true, confirmLabel: 'Eliminar' })) { await sessions.delete(s.id); dlg.close(); toast('Clase eliminada'); void refresh(); } } }, icon('trash', 16), 'Eliminar clase');
    dlg.querySelector('.modal-actions')!.prepend(del);
  }
}

function listMode(c: Ctx, sess: Session[], today: string) {
  const { sem, data } = c; const subj = new Map(data.subjects.map((s) => [s.id, s]));
  const box = h('div', { class: 'stack' });
  const dates = [...new Set(sess.map((s) => s.date))];
  type Row = { date: string; node: HTMLElement };
  const rows: Row[] = dates.map((d) => {
    const items = sess.filter((s) => s.date === d).sort((a, b) => a.turnStart - b.turnStart);
    const wk = items.find((x) => x.week)?.week;
    return { date: d, node: h('article', { class: 'card' },
      h('div', { class: 'row between' }, h('strong', null, fmtLong(d)), h('span', { class: 'tag' }, wk ? `Semana lectiva ${wk}` : 'Clases')),
      h('ul', { class: 'plain', style: 'margin-top:6px' }, items.map((s) => { const t = sessionTimes(s, sem); return h('li', { class: 'row', style: 'padding:3px 0' }, badge(subj.get(s.subjectId ?? ''), s.symbol), h('span', null, `${t.start}–${t.end}`), h('span', { class: 'soft small grow' }, subj.get(s.subjectId ?? '')?.name ?? 'Sin asignar'), s.partial ? h('span', { class: 'tag warn' }, '∆') : null, h('button', { class: 'icon-btn plain', type: 'button', 'aria-label': `Editar clase ${s.symbol}`, onClick: () => sessionForm(c, s) }, icon('pencil', 18))); }))) };
  });
  for (const e of data.events.filter((e) => e.startDate)) rows.push({ date: e.startDate!, node: eventCard(e, c) });
  rows.sort((a, b) => a.date.localeCompare(b.date));
  let marked = false;
  for (const r of rows) {
    if (!marked && r.date >= today) { box.append(h('div', { class: 'today-mark', style: 'margin:6px 0' }, '▼ Desde hoy')); marked = true; }
    box.append(r.node);
  }
  if (!rows.length) box.append(h('div', { class: 'card soft' }, 'No hay clases que mostrar con este filtro.'));
  void daysBetween;
  return box;
}

function monthMode(c: Ctx, today: string, nav: (label: string, step: number) => HTMLElement) {
  const base = fromISO(st.date); const first = new Date(base.getFullYear(), base.getMonth(), 1, 12);
  const gridStart = startOfWeek(toISO(first));
  const all = collectEvents(c.data).filter((e) => (!st.filter || e.subjectId === st.filter || e.subjectId === null) && st.types.has(e.type));
  const wrap = h('div', null, nav(fmtMonth(toISO(first)), 1));
  wrap.append(h('div', { class: 'filters', role: 'group', 'aria-label': 'Tipos de evento' }, (Object.keys(CAL_LABEL) as CalType[]).map((t) => {
    const cb = h('input', { type: 'checkbox', checked: st.types.has(t), onChange: () => { if (cb.checked) st.types.add(t); else st.types.delete(t); void refresh(); } });
    return h('label', { class: 'check' }, cb, CAL_LABEL[t], h('small', { class: 'soft' }, CAL_OFFICIAL[t] ? '(oficial)' : '(personal)'));
  })));
  const grid = h('div', { class: 'month', role: 'grid', 'aria-label': fmtMonth(toISO(first)) }, ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => h('div', { class: 'dow', role: 'columnheader' }, d)));
  const LET: Record<CalType, string> = { clase: 'C', evento: 'E', evaluacion: 'Ev', entrega: 'T', inicio: 'I', objetivo: 'O' };
  for (let i = 0; i < 42; i++) {
    const iso = addDays(gridStart, i); const d = fromISO(iso);
    const evs = all.filter((e) => e.date === iso);
    const types = [...new Set(evs.map((e) => e.type))];
    grid.append(h('button', { type: 'button', role: 'gridcell', class: `day${d.getMonth() !== first.getMonth() ? ' out' : ''}${iso === today ? ' today' : ''}${iso === st.sel ? ' sel' : ''}`, 'aria-label': `${fmtLong(iso)}${evs.length ? ', ' + evs.length + ' eventos' : ''}`, onClick: () => { st.sel = iso; void refresh(); } },
      h('span', null, d.getDate()), h('span', { class: 'marks' }, types.map((t) => h('span', { class: 'mk' + (CAL_OFFICIAL[t] ? '' : ' p') }, LET[t])))));
  }
  wrap.append(grid, h('p', { class: 'soft small' }, 'C clase · E evento · Ev evaluación · T entrega · I inicio de trabajo · O objetivo. Borde punteado = fecha personal.'));
  if (st.sel) {
    const evs = all.filter((e) => e.date === st.sel);
    wrap.append(h('h2', { class: 'section-title' }, fmtLong(st.sel)));
    if (!evs.length) wrap.append(h('div', { class: 'card soft' }, 'Nada registrado este día.'));
    for (const e of evs) {
      const sb = c.data.subjects.find((x) => x.id === e.subjectId);
      wrap.append(h('article', { class: 'card sess', style: `margin-bottom:8px;border-left-color:${subjectColor(sb?.colorIndex ?? 0).fg}` },
        h('div', { class: 'row' }, h('span', { class: 'tag ' + (e.official ? 'official' : 'personal') }, (e.official ? 'Oficial · ' : 'Personal · ') + CAL_LABEL[e.type]), sb ? badge(sb) : null),
        h('strong', null, e.title), h('div', { class: 'soft small' }, [e.time, e.detail].filter(Boolean).join(' · ')), e.link ? h('a', { href: e.link, class: 'small' }, 'Abrir') : null));
    }
  }
  return wrap;
}
