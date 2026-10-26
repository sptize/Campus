import { h } from '../ui/h';
import { icon } from '../ui/icons';
import { loadActive } from '../app/context';
import { go, refresh } from '../app/router';
import { badge, emptyState, sessionCard } from '../ui/parts';
import { collectEvents } from '../services/calendar';
import { assignmentStatus, daysLabel, daysLeft, evaluationBucket, nextSession, nowMinutes, objectiveProgress } from '../services/status';
import { daysBetween, fmtLong, todayISO } from '../services/dates';
import { getSetting, setSetting, ALL_TABLES } from '../db/idb';
import { exportNow } from './backup-ui';
import { newYearForm } from './settings';

export async function homeView(root: HTMLElement) {
  const c = await loadActive();
  const today = todayISO();
  const has = (await Promise.all(ALL_TABLES.filter((t) => t.name !== 'settings').map((t) => t.count()))).some((n) => n > 0);
  const last = await getSetting<number | null>('lastBackupAt', null);
  const dismissed = await getSetting<number>('backupDismissedUntil', 0);
  if (has && Date.now() > dismissed && (!last || Date.now() - last > 14 * 86400000)) {
    root.append(h('section', { class: 'info', 'aria-label': 'Aviso de copia de seguridad', style: 'margin-bottom:14px' },
      h('p', null, 'Tus datos se guardan únicamente en este dispositivo. Si borras los datos del navegador o desinstalas la app, se pierden. Descarga una copia de seguridad de vez en cuando.'),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onClick: async () => { if (await exportNow()) void refresh(); } }, 'Exportar ahora'),
        h('button', { class: 'btn sm ghost', type: 'button', onClick: async () => { await setSetting('backupDismissedUntil', Date.now() + 7 * 86400000); void refresh(); } }, 'Entendido'))));
  }
  if (!c) {
    root.append(emptyState('notebook', 'Aún no tienes un horario', 'Carga el Excel de tu horario o crea un año académico y semestre a mano.',
      h('div', { class: 'row', style: 'justify-content:center' }, h('a', { class: 'btn primary', href: '#/importar' }, icon('sheet', 18), 'Cargar nuevo Excel'),
        h('button', { class: 'btn', type: 'button', onClick: () => newYearForm(() => void refresh()) }, 'Crear año académico'))));
    return;
  }
  const { sem, data } = c;
  const subj = new Map(data.subjects.map((s) => [s.id, s]));
  const events = collectEvents(data);
  const todayEv = events.filter((e) => e.date === today);

  // Hoy
  const hoy = h('section', { class: 'stack' }, h('h2', { class: 'section-title', style: 'margin-top:0' }, 'Hoy'));
  if (!todayEv.length) hoy.append(h('div', { class: 'card soft' }, 'Hoy no tienes clases ni fechas registradas.'));
  for (const s of data.sessions.filter((x) => x.date === today).sort((a, b) => a.turnStart - b.turnStart)) hoy.append(sessionCard(s, subj.get(s.subjectId ?? ''), sem));
  for (const e of todayEv.filter((x) => x.type !== 'clase')) hoy.append(h('div', { class: 'card' }, h('span', { class: 'tag ' + (e.official ? 'official' : 'personal') }, e.official ? 'Oficial' : 'Personal'), ' ', h('strong', null, e.title), h('div', { class: 'soft small' }, e.detail)));
  root.append(hoy);

  // Próxima clase
  const ns = nextSession(data.sessions, sem, today, nowMinutes());
  const nextBox = h('section', { class: 'stack' }, h('h2', { class: 'section-title' }, 'Próxima clase'));
  if (ns) {
    const d = daysBetween(today, ns.date);
    nextBox.append(h('p', { class: 'soft', style: 'margin:0' }, `${fmtLong(ns.date)} · ${d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`}`));
    const same = data.sessions.filter((x) => x.date === ns.date).sort((a, b) => a.turnStart - b.turnStart);
    for (const s of same) nextBox.append(sessionCard(s, subj.get(s.subjectId ?? ''), sem));
  } else nextBox.append(h('div', { class: 'card soft' }, 'No quedan clases registradas en este semestre.'));
  root.append(nextBox);

  // Próxima evaluación / entrega
  const ev = data.evaluations.filter((e) => e.date && evaluationBucket(e, today) === 'proxima').sort((a, b) => a.date!.localeCompare(b.date!))[0];
  const late = data.assignments.filter((a) => assignmentStatus(a, today) === 'atrasado');
  const asg = data.assignments.filter((a) => a.dueDate && ['pendiente', 'en_curso'].includes(assignmentStatus(a, today)) && a.dueDate >= today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0];
  root.append(h('h2', { class: 'section-title' }, 'Lo que viene'),
    h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('h3', null, 'Próxima evaluación'), ev ? h('div', null, h('div', { class: 'row' }, badge(subj.get(ev.subjectId)), h('strong', null, ev.name)), h('div', { class: 'soft' }, `${fmtLong(ev.date!)}${ev.time ? ' · ' + ev.time : ''} · ${daysLabel(daysLeft(ev.date, today))}`)) : h('p', { class: 'soft' }, 'No tienes evaluaciones próximas registradas.'), h('a', { class: 'btn sm ghost', href: '#/planificador' }, ev ? 'Ver evaluaciones' : 'Añadir evaluación')),
      h('div', { class: 'card' }, h('h3', null, 'Próxima entrega'), asg ? h('div', null, h('div', { class: 'row' }, badge(subj.get(asg.subjectId)), h('strong', null, asg.title)), h('div', { class: 'soft' }, `${fmtLong(asg.dueDate!)} · ${daysLabel(daysLeft(asg.dueDate, today))}`)) : h('p', { class: 'soft' }, 'No tienes entregas pendientes con fecha.'), late.length ? h('p', null, h('span', { class: 'tag bad' }, icon('alert', 14), ` ${late.length} trabajo${late.length > 1 ? 's' : ''} atrasado${late.length > 1 ? 's' : ''}`)) : null, h('a', { class: 'btn sm ghost', href: '#/planificador?tab=trabajos' }, asg ? 'Ver trabajos' : 'Añadir trabajo')),
      (() => { const p = objectiveProgress(data.objectives); return h('div', { class: 'card' }, h('h3', null, 'Objetivos'), p.total ? h('div', null, h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': p.pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Objetivos completados' }, h('span', { style: `width:${p.pct}%` })), h('p', { class: 'soft' }, `${p.done} de ${p.total} completados · ${data.objectives.filter((o) => o.status === 'en_curso').length} en curso`)) : h('p', { class: 'soft' }, 'Aún no has definido objetivos. Créalos desde la ficha de cada asignatura.'), h('a', { class: 'btn sm ghost', href: '#/asignaturas' }, 'Ir a asignaturas')); })())); 

  root.append(h('h2', { class: 'section-title' }, 'Accesos'),
    h('div', { class: 'grid2' },
      h('a', { class: 'linkcard', href: '#/horario' }, icon('calendar'), 'Horario'), h('a', { class: 'linkcard', href: '#/asignaturas' }, icon('book'), 'Asignaturas'),
      h('a', { class: 'linkcard', href: '#/planificador?tab=trabajos' }, icon('list'), 'Trabajos'), h('a', { class: 'linkcard', href: '#/planificador?tab=evaluaciones' }, icon('flag'), 'Evaluaciones'),
      h('a', { class: 'linkcard', href: '#/ajustes?foco=datos' }, icon('database'), 'Datos y copias'), h('a', { class: 'linkcard', href: '#/importar' }, icon('sheet'), 'Cargar nuevo Excel')));
  void go;
}
