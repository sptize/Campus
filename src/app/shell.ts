import { h } from '../ui/h';
import { icon, type IconName } from '../ui/icons';
import { APP_NAME } from '../config';
import { getSetting } from '../db/idb';
import { allSemesters, activeSemester, setActiveSemester } from '../services/queries';
import { fmtFull, todayISO } from '../services/dates';
import { canInstall, promptInstall, onUpdateReady, updateReady, applyUpdate } from './pwa';
import { refresh, go } from './router';

const NAV: { id: string; label: string; href: string; ic: IconName }[] = [
  { id: 'inicio', label: 'Inicio', href: '#/', ic: 'home' },
  { id: 'horario', label: 'Horario', href: '#/horario', ic: 'calendar' },
  { id: 'asignaturas', label: 'Asignaturas', href: '#/asignaturas', ic: 'book' },
  { id: 'planificador', label: 'Planificador', href: '#/planificador', ic: 'list' },
  { id: 'ajustes', label: 'Ajustes', href: '#/ajustes', ic: 'sliders' },
];
export let appName = APP_NAME;

export function buildShell() {
  const app = document.getElementById('app')!;
  const rings = h('div', { class: 'rings', 'aria-hidden': 'true' }, Array.from({ length: 18 }, () => h('i')));
  const install = h('button', { class: 'btn sm ghost', type: 'button', hidden: true, onClick: () => void promptInstall() }, icon('download', 18), 'Instalar app');
  const upd = h('button', { class: 'btn sm primary', type: 'button', hidden: true, onClick: () => go('#/ajustes?foco=actualizar') }, icon('refresh', 18), 'Actualización');
  const title = h('h1', { id: 'appTitle' }, APP_NAME);
  const dateEl = h('div', { class: 'date', id: 'today' });
  const semEl = h('div', { class: 'sem', id: 'semline' });
  const online = h('span', { class: 'chip', id: 'onlineChip' }, h('span', { class: 'dot' }), 'En línea');
  const header = h('header', { class: 'top' }, rings,
    h('div', { class: 'top-row' }, title, h('div', { class: 'top-actions' }, install, upd)),
    dateEl, semEl, h('div', { class: 'chips' }, online, h('span', { class: 'chip' }, 'Datos solo en este dispositivo')));
  const nav = h('nav', { class: 'tabbar', 'aria-label': 'Navegación principal' }, NAV.map((n) => h('a', { href: n.href, id: 'nav-' + n.id }, icon(n.ic, 22), h('span', null, n.label))));
  app.append(header, h('main', { id: 'view', tabindex: '-1' }), nav);
  const setOnline = () => { online.lastChild!.textContent = navigator.onLine ? 'En línea' : 'Sin conexión'; (online.firstChild as HTMLElement).className = 'dot' + (navigator.onLine ? '' : ' off'); };
  window.addEventListener('online', setOnline); window.addEventListener('offline', setOnline); setOnline();
  const syncBtns = () => { install.hidden = !canInstall(); upd.hidden = !updateReady(); };
  document.addEventListener('installable', syncBtns); onUpdateReady(syncBtns); syncBtns();
  void applyUpdate;
}

export async function updateHeader(navId: string) {
  appName = await getSetting<string>('appName', APP_NAME);
  document.getElementById('appTitle')!.textContent = appName; document.title = appName;
  document.getElementById('today')!.textContent = fmtFull(todayISO());
  for (const n of NAV) { const a = document.getElementById('nav-' + n.id)!; if (n.id === navId) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  const line = document.getElementById('semline')!; line.textContent = '';
  const act = await activeSemester(); const list = await allSemesters();
  if (!act) { line.textContent = 'Sin semestre activo'; return; }
  const label = (x: typeof act) => `${x.year.course} · ${x.sem.number}.º semestre${x.sem.group ? ' · ' + x.sem.group : ''}`;
  if (list.length > 1) {
    const sel = h('select', { 'aria-label': 'Semestre activo', style: 'min-height:38px;border-radius:12px;border:1.5px solid var(--border);background:rgba(255,255,255,.7);padding:2px 8px;max-width:100%' },
      list.map((x) => h('option', { value: x.sem.id, selected: x.sem.id === act.sem.id }, label(x))));
    sel.addEventListener('change', async () => { await setActiveSemester(sel.value); void refresh(false); });
    line.append(sel);
  } else line.textContent = label(act);
}
