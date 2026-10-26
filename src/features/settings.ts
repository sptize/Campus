import { h } from '../ui/h';
import { icon } from '../ui/icons';
import { APP_NAME, APP_VERSION } from '../config';
import { years, semesters, getSetting, setSetting } from '../db/idb';
import type { Semester, Year } from '../db/types';
import { allSemesters, activeSemester, setActiveSemester, deleteSemesterCascade, deleteYearCascade } from '../services/queries';
import { buildBackup, validateBackup, restoreBackup, localCounts, type Validation } from '../services/backup';
import { yearId, semesterId } from '../services/importService';
import { checkForUpdate, applyUpdate, updateReady, canInstall, promptInstall, isStandalone } from '../app/pwa';
import { refresh } from '../app/router';
import { formModal, confirmDialog, dialogShell, toast, reportError } from '../ui/modal';
import { pageTitle } from '../ui/parts';
import { exportNow, downloadBlob } from './backup-ui';
import { backupFileName } from '../services/backup';

export function newYearForm(done: () => void) {
  formModal({
    title: 'Nuevo año académico',
    fields: [
      { name: 'career', label: 'Carrera', type: 'text', value: 'Ing. Informática', required: true },
      { name: 'course', label: 'Curso académico', type: 'text', value: '2026-2027', required: true, placeholder: '2026-2027' },
      { name: 'level', label: 'Año de la carrera', type: 'text', value: '4to', required: true },
    ],
    validate: (v) => { const m = String(v.course).match(/^(\d{4})-(\d{4})$/); return !m || +m[2] !== +m[1] + 1 ? 'El curso debe tener el formato 2026-2027.' : null; },
    onSubmit: async (v) => {
      const id = yearId(v.career, v.course);
      if (await years.get(id)) throw new Error('Ese año académico ya existe.');
      await years.put({ id, career: v.career, course: v.course, level: v.level, createdAt: Date.now() }); toast('Año académico creado'); done();
    },
  });
}

async function newSemesterForm(done: () => void) {
  const ys = await years.all();
  if (!ys.length) { toast('Primero crea un año académico.', 'error'); return; }
  formModal({
    title: 'Nuevo semestre',
    fields: [
      { name: 'yearId', label: 'Año académico', type: 'select', value: ys[0].id, options: ys.map((y) => ({ value: y.id, label: `${y.course} · ${y.level} · ${y.career}` })) },
      { name: 'number', label: 'Número de semestre', type: 'number', value: 1, required: true, min: 1, max: 4, step: 1 },
      { name: 'group', label: 'Grupo', type: 'text', value: 'Info-35' }, { name: 'room', label: 'Aula', type: 'text', value: '' },
      { name: 'startTime', label: 'Hora del primer turno', type: 'time', value: '09:00', required: true },
      { name: 'turnMinutes', label: 'Duración de cada turno (min)', type: 'number', value: 45, required: true, min: 5, max: 240, step: 1 },
    ],
    onSubmit: async (v) => {
      const sid = semesterId(v.yearId, v.number);
      if (await semesters.get(sid)) throw new Error('Ese semestre ya existe en el año elegido.');
      await semesters.put({ id: sid, yearId: v.yearId, number: v.number, group: v.group, room: v.room, faculty: '', courseType: '', startTime: v.startTime, turnMinutes: v.turnMinutes, sourceName: null, importedAt: null, createdAt: Date.now() });
      await setActiveSemester(sid); toast('Semestre creado'); done();
    },
  });
}
function editSemesterForm(s: Semester, done: () => void) {
  formModal({
    title: `Configurar ${s.number}.º semestre`, intro: 'La duración y hora de inicio de los turnos no vienen en el Excel: las defines tú.',
    fields: [
      { name: 'group', label: 'Grupo', type: 'text', value: s.group }, { name: 'room', label: 'Aula', type: 'text', value: s.room },
      { name: 'startTime', label: 'Hora del primer turno', type: 'time', value: s.startTime, required: true },
      { name: 'turnMinutes', label: 'Duración de cada turno (min)', type: 'number', value: s.turnMinutes, required: true, min: 5, max: 240, step: 1 },
    ],
    onSubmit: async (v) => { await semesters.put({ ...s, group: v.group, room: v.room, startTime: v.startTime, turnMinutes: v.turnMinutes }); toast('Semestre actualizado'); done(); },
  });
}

export async function settingsView(root: HTMLElement, _p: string[], q: URLSearchParams) {
  const done = () => void refresh();
  const act = await activeSemester(); const list = await allSemesters(); const ys = await years.all();
  root.append(pageTitle('Ajustes'));

  /* --- Años y semestres --- */
  const acad = h('section', { class: 'stack', id: 'academico' }, h('h2', { class: 'section-title', style: 'margin-top:0' }, 'Años y semestres'));
  if (!ys.length) acad.append(h('div', { class: 'card soft' }, 'Todavía no hay años académicos.'));
  for (const y of ys.sort((a, b) => b.course.localeCompare(a.course))) {
    const sems = list.filter((x) => x.year.id === y.id).map((x) => x.sem).sort((a, b) => a.number - b.number);
    acad.append(h('article', { class: 'card' },
      h('div', { class: 'row between' }, h('div', null, h('h3', null, `Curso ${y.course}`), h('div', { class: 'soft small' }, `${y.level} año · ${y.career}`)),
        h('button', { class: 'btn sm danger', type: 'button', onClick: async () => { if (await confirmDialog(`¿Eliminar el curso ${y.course} con todos sus semestres, notas, evaluaciones y trabajos? No se puede deshacer.`, { danger: true, confirmLabel: 'Eliminar curso' })) { await deleteYearCascade(y.id); toast('Curso eliminado'); done(); } } }, icon('trash', 16), 'Eliminar')),
      sems.length ? h('ul', { class: 'plain' }, sems.map((s) => h('li', { style: 'border-top:1px solid var(--border);padding:10px 0' },
        h('div', { class: 'row between' }, h('strong', null, `${s.number}.º semestre${s.group ? ' · ' + s.group : ''}`), act?.sem.id === s.id ? h('span', { class: 'tag' }, 'Activo') : h('button', { class: 'btn sm', type: 'button', onClick: async () => { await setActiveSemester(s.id); done(); } }, 'Activar')),
        h('div', { class: 'soft small' }, `Turnos de ${s.turnMinutes} min desde las ${s.startTime}${s.importedAt ? ' · Excel: ' + (s.sourceName ?? '') + ' (' + new Date(s.importedAt).toLocaleDateString('es') + ')' : ' · Sin Excel importado'}`),
        h('div', { class: 'row', style: 'margin-top:6px' }, h('a', { class: 'btn sm primary', href: '#/importar' }, icon('sheet', 16), 'Cargar nuevo Excel'), h('button', { class: 'btn sm', type: 'button', onClick: () => editSemesterForm(s, done) }, icon('pencil', 16), 'Configurar'),
          h('button', { class: 'btn sm danger', type: 'button', onClick: async () => { if (await confirmDialog(`¿Eliminar el ${s.number}.º semestre con todos sus datos? No se puede deshacer.`, { danger: true, confirmLabel: 'Eliminar semestre' })) { await deleteSemesterCascade(s.id); toast('Semestre eliminado'); done(); } } }, icon('trash', 16), 'Eliminar'))))) : h('p', { class: 'soft' }, 'Sin semestres.')));
  }
  acad.append(h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onClick: () => newYearForm(done) }, icon('plus', 16), 'Nuevo año académico'), h('button', { class: 'btn', type: 'button', onClick: () => void newSemesterForm(done) }, icon('plus', 16), 'Nuevo semestre')));
  root.append(acad);

  /* --- Datos y copias de seguridad --- */
  const last = await getSetting<number | null>('lastBackupAt', null);
  const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr', id: 'restoreFile', 'aria-label': 'Elegir copia de seguridad' });
  file.addEventListener('change', () => { const f = file.files?.[0]; file.value = ''; if (f) void restoreFlow(f, done); });
  root.append(h('section', { class: 'stack', id: 'datos' }, h('h2', { class: 'section-title' }, 'Datos y copias de seguridad'),
    h('div', { class: 'info' }, h('p', null, 'Tus datos se guardan solo en este dispositivo, dentro del navegador. Si borras los datos del navegador o desinstalas la app se pierden. Para cambiar de móvil: guarda una copia aquí, pásala al otro teléfono y recupérala allí. No hace falta cuenta ni servidor.'),
      h('p', { class: 'soft small' }, last ? 'Última copia: ' + new Date(last).toLocaleString('es', { dateStyle: 'long', timeStyle: 'short' }) : 'Todavía no has guardado ninguna copia.'),
      h('p', { class: 'soft small' }, 'La copia incluye años, semestres, asignaturas, clases, notas, objetivos, evaluaciones, trabajos y ajustes. No incluye los archivos Excel originales (vuelve a cargarlos si los necesitas).')),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onClick: async () => { if (await exportNow()) done(); } }, icon('download', 18), 'Guardar copia de seguridad'),
      h('label', { class: 'btn', for: 'restoreFile', tabindex: '0', role: 'button', onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } } }, icon('upload', 18), 'Recuperar copia de seguridad'), file)));

  /* --- Aplicación --- */
  const name = await getSetting('appName', APP_NAME);
  const msg = h('p', { 'aria-live': 'polite', id: 'updMsg', class: 'soft' }, `Versión instalada: ${APP_VERSION}`);
  const btn = h('button', { class: 'btn primary', type: 'button', id: 'updBtn' }, icon('refresh', 18), 'Actualizar app');
  const apply = h('button', { class: 'btn', type: 'button', hidden: true, onClick: () => { msg.textContent = 'Aplicando actualización… la app se reiniciará y tus datos se conservan.'; applyUpdate(); } }, 'Aplicar actualización ahora');
  const showAvail = () => { msg.textContent = `Hay una versión nueva disponible (instalada: ${APP_VERSION}). Tus datos no se tocan al actualizar. Guarda lo que estés escribiendo y pulsa "Aplicar actualización ahora".`; apply.hidden = false; };
  if (updateReady()) showAvail();
  btn.addEventListener('click', async () => {
    btn.disabled = true; msg.textContent = 'Comprobando…';
    const r = await checkForUpdate(); btn.disabled = false;
    if (r === 'available') showAvail();
    else if (r === 'offline') msg.textContent = `Sin conexión: no se puede comprobar. Sigues usando la versión instalada (${APP_VERSION}).`;
    else if (r === 'unsupported') msg.textContent = `Este navegador o modo no admite actualizaciones automáticas. Versión instalada: ${APP_VERSION}.`;
    else msg.textContent = `Ya tienes la última versión (${APP_VERSION}).`;
  });
  const persisted = (await navigator.storage?.persisted?.().catch(() => false)) ?? false;
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  root.append(h('section', { class: 'stack', id: 'actualizar' }, h('h2', { class: 'section-title' }, 'Aplicación'),
    h('div', { class: 'card' }, h('h3', null, 'Actualizar app'), msg, h('div', { class: 'row' }, btn, apply)),
    h('div', { class: 'card' }, h('h3', null, 'Nombre de la app'), h('p', { class: 'soft small' }, 'Se muestra en la cabecera. También se puede cambiar en src/config.ts.'),
      h('button', { class: 'btn sm', type: 'button', onClick: () => formModal({ title: 'Nombre de la app', fields: [{ name: 'n', label: 'Nombre', type: 'text', value: name, required: true }], onSubmit: async (v) => { await setSetting('appName', v.n); toast('Nombre actualizado'); done(); } }) }, icon('pencil', 16), 'Cambiar nombre (' + name + ')')),
    canInstall() ? h('div', { class: 'card' }, h('h3', null, 'Instalar'), h('button', { class: 'btn', type: 'button', onClick: () => void promptInstall() }, icon('download', 18), 'Instalar app')) : null,
    h('div', { class: 'card soft small' }, h('p', null, `Instalada como app: ${isStandalone() ? 'sí' : 'no (abierta en el navegador)'}.`), h('p', null, `Almacenamiento protegido: ${persisted ? 'sí' : 'no garantizado'}.${est?.usage !== undefined ? ` Uso: ${(est.usage / 1024).toFixed(0)} KB.` : ''}`),
      h('p', null, 'Sin analítica ni telemetría: ningún dato académico sale del dispositivo salvo que tú exportes una copia.'))));
  if (q.get('foco')) setTimeout(() => document.getElementById(q.get('foco') === 'datos' ? 'datos' : q.get('foco') === 'actualizar' ? 'actualizar' : 'academico')?.scrollIntoView(), 50);
}

/* --------- Recuperar copia: validar → resumen → confirmar → restaurar --------- */
async function restoreFlow(f: File, done: () => void) {
  try {
    if (f.size > 50 * 1024 * 1024) throw new Error('El archivo es demasiado grande para ser una copia de CampusPocket.');
    let raw: unknown;
    try { raw = JSON.parse(await f.text()); } catch { throw new Error('El archivo no es un JSON válido.'); }
    const v = validateBackup(raw);
    const local = await localCounts();
    const hasLocal = Object.entries(local).some(([k, n]) => k !== 'settings' && n > 0);
    const body: Node[] = [];
    if (!v.ok) {
      body.push(h('div', { class: 'info bad' }, h('h3', null, 'Esta copia no se puede restaurar'), h('ul', null, v.errors.map((e) => h('li', null, e)))), h('p', { class: 'soft' }, 'No se ha modificado ningún dato.'),
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onClick: () => dlg.close() }, 'Cerrar')));
      var dlg = dialogShell('Copia incompatible', body); return;
    }
    const names: Record<string, string> = { years: 'Años', semesters: 'Semestres', subjects: 'Asignaturas', sessions: 'Clases', events: 'Eventos', notes: 'Notas', objectives: 'Objetivos', evaluations: 'Evaluaciones', assignments: 'Trabajos' };
    const rows = Object.entries(names).map(([k, l]) => h('tr', null, h('td', null, l), h('td', null, String(v.counts[k] ?? 0)), h('td', null, String(local[k] ?? 0))));
    let mode: 'replace' | 'merge' = 'replace'; let pre = hasLocal;
    const radio = (val: 'replace' | 'merge', label: string, help: string) => { const r = h('input', { type: 'radio', name: 'mode', checked: mode === val, onChange: () => { mode = val; } }); return h('label', { class: 'card', style: 'display:flex;gap:10px;align-items:flex-start;margin-bottom:8px' }, r, h('span', null, h('strong', null, label), h('br'), h('span', { class: 'soft small' }, help))); };
    const preCb = h('input', { type: 'checkbox', checked: pre, onChange: () => { pre = preCb.checked; } });
    body.push(h('div', { class: 'info' }, `Copia del ${v.exportedAt ? new Date(v.exportedAt).toLocaleString('es') : 'fecha desconocida'} · app ${v.appVersion ?? '?'}`),
      h('div', { class: 'scroll-x' }, h('table', { class: 'prev' }, h('thead', null, h('tr', null, h('th', null, 'Datos'), h('th', null, 'En la copia'), h('th', null, 'Ahora aquí'))), h('tbody', null, rows))),
      ...(v.warnings.length ? [h('p', { class: 'soft small' }, v.warnings.join(' '))] : []),
      hasLocal ? h('div', { class: 'info warn' }, 'Ya hay datos en este dispositivo. Con "Reemplazar" se sustituyen por los de la copia.') : null as any,
      radio('replace', 'Reemplazar todo', 'Deja este dispositivo exactamente como la copia (restauración completa).'), radio('merge', 'Combinar', 'Añade solo lo que no existe aquí. Los registros con el mismo identificador se conservan como están en este dispositivo.'),
      hasLocal ? h('label', { class: 'row', style: 'min-height:44px' }, preCb, 'Descargar antes una copia de lo que hay ahora') : null as any,
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn ghost', type: 'button', onClick: () => dlg2.close() }, 'Cancelar'),
        h('button', { class: 'btn primary', type: 'button', onClick: async (ev: Event) => {
          const b = ev.currentTarget as HTMLButtonElement; b.disabled = true;
          try {
            if (hasLocal && pre) downloadBlob(new Blob([JSON.stringify(await buildBackup(), null, 1)], { type: 'application/json' }), backupFileName().replace('copia-', 'copia-previa-'));
            const r = await restoreBackup(raw, mode);
            const total = Object.values(r.added).reduce((a, n) => a + n, 0);
            dlg2.close(); toast(`Restauración completada: ${total} registros ${mode === 'replace' ? 'restaurados' : 'añadidos'}.`); done();
          } catch (e) { b.disabled = false; reportError(e, 'No se pudo restaurar (no se modificó nada)'); }
        } }, 'Restaurar')));
    var dlg2 = dialogShell('Recuperar copia de seguridad', body);
  } catch (e) { reportError(e, 'No se pudo leer la copia'); }
}
