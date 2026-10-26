import { h } from './h';
import { icon } from './icons';

export function toast(msg: string, kind: 'ok' | 'error' = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite', role: 'status' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + kind }, msg);
  box.append(t); setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3000);
}
/** Gestión centralizada de errores: mensajes comprensibles, incluida la falta de almacenamiento. */
export function reportError(e: unknown, context = 'No se pudo completar la acción') {
  console.error(context, e);
  const name = (e as any)?.name;
  if (name === 'QuotaExceededError') toast('No hay espacio suficiente en el dispositivo. Libera espacio o exporta una copia y borra datos antiguos.', 'error');
  else toast(`${context}: ${(e as Error)?.message ?? 'error desconocido'}`, 'error');
}

export type Field =
  | { name: string; label: string; type: 'text' | 'date' | 'time' | 'number' | 'textarea' | 'url'; value?: any; required?: boolean; placeholder?: string; help?: string; min?: number; max?: number; step?: number; rows?: number }
  | { name: string; label: string; type: 'select'; value?: any; required?: boolean; options: { value: string; label: string }[]; help?: string }
  | { name: string; label: string; type: 'custom'; el: HTMLElement; get: () => any };

export interface FormOptions {
  title: string; fields: Field[]; submitLabel?: string; intro?: string | Node;
  validate?: (v: Record<string, any>) => string | null;
  onSubmit: (v: Record<string, any>) => Promise<void> | void;
  extra?: Node[];
}

export function dialogShell(title: string, body: Node[], onClose?: () => void) {
  const dlg = h('dialog', { class: 'modal', 'aria-label': title });
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  dlg.append(h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cerrar', onClick: () => dlg.close() }, icon('x'))), ...body);
  document.body.append(dlg); dlg.showModal();
  return dlg;
}

export function formModal(o: FormOptions): HTMLDialogElement {
  const err = h('div', { class: 'form-error', role: 'alert' });
  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
  const rows = o.fields.map((f, i) => {
    const id = `f_${f.name}_${i}`;
    let control: HTMLElement;
    if (f.type === 'custom') control = f.el;
    else if (f.type === 'select') {
      const s = h('select', { id, name: f.name, required: !!f.required }, f.options.map((op) => h('option', { value: op.value, selected: String(f.value ?? '') === op.value }, op.label)));
      inputs.set(f.name, s); control = s;
    } else if (f.type === 'textarea') {
      const t = h('textarea', { id, name: f.name, rows: f.rows ?? 4, required: !!f.required, placeholder: f.placeholder }); t.value = f.value ?? '';
      inputs.set(f.name, t); control = t;
    } else {
      const i2 = h('input', { id, name: f.name, type: f.type, required: !!f.required, placeholder: f.placeholder, min: f.min, max: f.max, step: f.step ?? (f.type === 'number' ? 'any' : undefined), autocomplete: 'off' });
      i2.value = f.value ?? ''; inputs.set(f.name, i2); control = i2;
    }
    return h('div', { class: 'field' }, h('label', { for: id }, f.label, f.type !== 'custom' && f.required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null), control, 'help' in f && f.help ? h('small', { class: 'help' }, f.help) : null);
  });
  const form = h('form', { novalidate: true }, o.intro ? h('p', { class: 'soft' }, o.intro) : null, rows, err, ...(o.extra ?? []),
    h('div', { class: 'modal-actions' }, h('button', { type: 'button', class: 'btn ghost', onClick: () => dlg.close() }, 'Cancelar'), h('button', { type: 'submit', class: 'btn primary' }, o.submitLabel ?? 'Guardar')));
  const dlg = dialogShell(o.title, [form]);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); err.textContent = '';
    const values: Record<string, any> = {};
    for (const f of o.fields) {
      if (f.type === 'custom') { values[f.name] = f.get(); continue; }
      const el = inputs.get(f.name)!; const raw = el.value.trim();
      if (f.required && !raw) { err.textContent = `Completa el campo "${f.label}".`; el.focus(); return; }
      values[f.name] = f.type === 'number' ? (raw === '' ? null : Number(raw)) : raw;
      if (f.type === 'number' && raw !== '' && !isFinite(values[f.name])) { err.textContent = `"${f.label}" debe ser un número.`; el.focus(); return; }
    }
    const msg = o.validate?.(values); if (msg) { err.textContent = msg; return; }
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!; btn.disabled = true;
    try { await o.onSubmit(values); dlg.close(); } catch (e) { btn.disabled = false; err.textContent = (e as Error).message || 'No se pudo guardar.'; reportError(e, 'No se pudo guardar'); }
  });
  setTimeout(() => (dlg.querySelector('input,select,textarea') as HTMLElement | null)?.focus(), 30);
  return dlg;
}

export function confirmDialog(message: string, opts: { confirmLabel?: string; danger?: boolean; title?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const dlg = dialogShell(opts.title ?? 'Confirmar', [
      h('p', null, message),
      h('div', { class: 'modal-actions' }, h('button', { type: 'button', class: 'btn ghost', onClick: () => dlg.close() }, 'Cancelar'),
        h('button', { type: 'button', class: 'btn ' + (opts.danger ? 'danger' : 'primary'), onClick: () => { result = true; dlg.close(); } }, opts.confirmLabel ?? 'Aceptar')),
    ], () => resolve(result));
  });
}
