import { h, clear } from '../ui/h';
import { reportError } from '../ui/modal';

export type Handler = (root: HTMLElement, params: string[], q: URLSearchParams) => Promise<void> | void;
const routes: { re: RegExp; fn: Handler; nav: string }[] = [];
export const route = (re: RegExp, nav: string, fn: Handler) => routes.push({ re, fn, nav });
let afterRender: (nav: string) => void = () => {};
export const onRendered = (fn: (nav: string) => void) => { afterRender = fn; };

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, q: new URLSearchParams(qs ?? '') };
}
export const go = (hash: string) => { if (location.hash === hash) void refresh(false); else location.hash = hash; };
export const setQuery = (key: string, value: string) => { const { path, q } = parseHash(); q.set(key, value); go('#' + path + '?' + q.toString()); };

let token = 0;
export async function refresh(keepScroll = true) {
  const root = document.getElementById('view')!;
  const y = keepScroll ? window.scrollY : 0;
  const { path, q } = parseHash();
  const my = ++token;
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const box = h('div', { class: 'view' });
    try { await r.fn(box, m.slice(1), q); }
    catch (e) { reportError(e, 'Error al mostrar la pantalla'); box.append(h('div', { class: 'info bad' }, h('h3', null, 'No se pudo cargar esta pantalla'), h('p', null, (e as Error).message))); }
    if (my !== token) return; // llegó una navegación más nueva
    clear(root); root.append(box);
    window.scrollTo(0, y);
    afterRender(r.nav);
    return;
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', () => void refresh(false));
