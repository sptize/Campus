// Registro del Service Worker y actualización CONTROLADA (nunca silenciosa).
let reg: ServiceWorkerRegistration | undefined;
let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();
let installEvt: any = null;

export const updateReady = () => !!waiting;
export const onUpdateReady = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const markWaiting = (w: ServiceWorker) => { waiting = w; listeners.forEach((f) => f()); };

export function registerServiceWorker() {
  if (__DEV__ || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((r) => {
    reg = r;
    if (r.waiting && navigator.serviceWorker.controller) markWaiting(r.waiting);
    r.addEventListener('updatefound', () => {
      const nw = r.installing;
      nw?.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) markWaiting(nw); });
    });
  }).catch((e) => console.warn('Service worker no registrado', e));
}

export type UpdateResult = 'offline' | 'unsupported' | 'available' | 'none';
export async function checkForUpdate(): Promise<UpdateResult> {
  if (!navigator.onLine) return 'offline';
  if (!reg) return 'unsupported';
  if (waiting) return 'available';
  try {
    await reg.update();
    const inst = reg.installing;
    if (inst) await new Promise<void>((res) => {
      const t = setTimeout(res, 20000);
      inst.addEventListener('statechange', () => { if (inst.state === 'installed' || inst.state === 'redundant') { clearTimeout(t); res(); } });
    });
    if (reg.waiting && navigator.serviceWorker.controller) { markWaiting(reg.waiting); return 'available'; }
    return 'none';
  } catch { return 'offline'; }
}
export function applyUpdate() {
  if (!waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; document.dispatchEvent(new Event('installable')); });
window.addEventListener('appinstalled', () => { installEvt = null; document.dispatchEvent(new Event('installable')); });
export const canInstall = () => !!installEvt;
export async function promptInstall() { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; document.dispatchEvent(new Event('installable')); }
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
