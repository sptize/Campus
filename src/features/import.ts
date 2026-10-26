import { h } from '../ui/h';
import { icon } from '../ui/icons';
import { go } from '../app/router';
import { pageTitle } from '../ui/parts';
import { toast, reportError } from '../ui/modal';
import { parseSchedule, sha256Hex, type ImportPreview, type Warning } from '../services/importer';
import { XlsxError } from '../services/xlsx';
import { commitImport, findMatch, yearId, semesterId, type CommitResult, type MatchInfo } from '../services/importService';
import { setActiveSemester } from '../services/queries';
import { fmtLong, isISO, turnRange } from '../services/dates';
import { exportNow } from './backup-ui';

interface State { preview: ImportPreview; fileName: string; hash: string; blob: Blob; match: MatchInfo; startTime: string; turnMinutes: number; result: CommitResult | null; busy: boolean }
let S: State | null = null;
let err: string | null = null;

export async function importView(root: HTMLElement) {
  root.append(pageTitle('Cargar nuevo Excel'));
  const input = h('input', { type: 'file', id: 'xlsxFile', class: 'sr', accept: '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0]; if (!f) return;
    err = null;
    try {
      if (!/\.(xlsx|xls)$/i.test(f.name)) throw new XlsxError('Elige un archivo de Excel (.xlsx).');
      const buf = new Uint8Array(await f.arrayBuffer());
      const preview = await parseSchedule(buf);          // todo en memoria: no se guarda nada aún
      const hash = await sha256Hex(buf);
      S = { preview, fileName: f.name, hash, blob: new Blob([buf], { type: f.type }), match: await findMatch(preview, hash), startTime: '09:00', turnMinutes: 45, result: null, busy: false };
    } catch (e) { S = null; err = e instanceof XlsxError ? e.message : 'No se pudo leer el archivo: ' + ((e as Error).message ?? 'error desconocido'); if (!(e instanceof XlsxError)) console.error(e); }
    await draw();
  });
  const holder = h('div', { class: 'stack', id: 'importBody' });
  root.append(h('div', { class: 'info' }, h('p', null, 'Elige el Excel del horario. Se analiza en tu teléfono, verás una vista previa que puedes corregir y solo se guarda cuando confirmes. Tus notas, evaluaciones, objetivos y trabajos nunca se sobrescriben.')),
    h('div', { style: 'margin:12px 0' }, h('label', { class: 'btn primary', for: 'xlsxFile', tabindex: '0', role: 'button', onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } }, icon('sheet', 18), 'Elegir archivo Excel'), input), holder);
  const draw = async () => {
    holder.textContent = '';
    if (err) holder.append(h('div', { class: 'info bad', role: 'alert' }, h('h3', null, 'No se pudo importar'), h('p', null, err)));
    if (S) await preview(holder, S, draw);
  };
  if (S && S.result) await draw();
}

const tag = (w: Warning) => h('li', { style: 'margin-bottom:6px' }, h('span', { class: 'tag ' + (w.level === 'error' ? 'bad' : 'warn') }, w.level === 'error' ? 'Error' : 'Aviso'), ' ', w.text);

async function preview(box: HTMLElement, s: State, redraw: () => Promise<void>) {
  const p = s.preview; const m = p.meta;
  if (s.result) {
    const r = s.result;
    box.append(h('div', { class: 'info' }, h('h3', null, r.createdSemester ? 'Semestre creado e importado' : 'Horario actualizado'),
      h('p', null, `${r.subjects} asignaturas, ${r.sessions} clases y ${r.events} eventos guardados.${r.skipped ? ` ${r.skipped} clases se omitieron por estar incompletas.` : ''}`),
      h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '#/horario' }, 'Ver horario'), h('button', { class: 'btn', type: 'button', onClick: async () => { if (await exportNow()) toast('Copia guardada'); } }, icon('download', 16), 'Guardar copia ahora'))));
    return;
  }
  const refreshMatch = async () => { s.match = await findMatch(p, s.hash); await redraw(); };
  const meta = (key: keyof typeof m, label: string, type = 'text') => {
    const i = h('input', { type, id: 'm_' + key, style: 'width:100%;min-height:42px;border-radius:10px;border:1.5px solid var(--border);padding:4px 10px' }); i.value = String(m[key] ?? '');
    i.addEventListener('change', () => { (m as any)[key] = type === 'number' ? (i.value ? Number(i.value) : null) : i.value.trim(); void refreshMatch(); });
    return h('div', { class: 'field' }, h('label', { for: 'm_' + key }, label), i);
  };
  box.append(h('div', { class: 'card' }, h('h3', null, 'Archivo: ' + s.fileName), h('p', { class: 'soft small' }, `Hoja "${p.sheetName}". Datos leídos del Excel (puedes corregirlos).`),
    h('div', { class: 'grid2' }, meta('career', 'Carrera'), meta('course', 'Curso'), meta('level', 'Año de la carrera'), meta('semester', 'Semestre', 'number'), meta('group', 'Grupo'), meta('room', 'Aula'))));

  // ¿Nuevo o existente?
  const ok = !!(m.career && /^\d{4}-\d{4}$/.test(m.course) && m.semester);
  const mt = s.match;
  let verdict: Node;
  if (!ok) verdict = h('div', { class: 'info bad' }, 'Faltan datos para saber a qué semestre pertenece este Excel. Complétalos arriba (carrera, curso 2026-2027 y semestre).');
  else if (mt.semester) verdict = h('div', { class: 'info warn' }, h('strong', null, 'Este Excel corresponde a un semestre que ya existe '), `(${m.course}, ${m.semester}.º semestre). Si continúas, se actualiza su horario conservando notas, objetivos, evaluaciones, trabajos y tus cambios manuales. Los semestres anteriores no se tocan.`);
  else if (mt.year) verdict = h('div', { class: 'info' }, `Se creará el ${m.semester}.º semestre dentro del curso ${m.course}, que ya existe.`);
  else verdict = h('div', { class: 'info' }, `Se creará el curso ${m.course} y su ${m.semester}.º semestre. Los semestres existentes no se modifican.`);
  box.append(verdict);
  if (mt.sameFile) box.append(h('div', { class: 'info warn' }, `Este mismo archivo ya se importó el ${new Date(mt.sameFile.importedAt).toLocaleDateString('es', { dateStyle: 'long' })}. Importarlo otra vez no duplica nada: se reemplazan los mismos registros.`));

  if (!mt.semester) {
    const st = h('input', { type: 'time', value: s.startTime, 'aria-label': 'Hora del primer turno', style: 'min-height:42px;border-radius:10px;border:1.5px solid var(--border);padding:4px 10px' }); st.addEventListener('change', () => { s.startTime = st.value || '09:00'; void redraw(); });
    const tm = h('input', { type: 'number', min: 5, max: 240, value: s.turnMinutes, 'aria-label': 'Minutos por turno', style: 'width:90px;min-height:42px;border-radius:10px;border:1.5px solid var(--border);padding:4px 10px' }); tm.addEventListener('change', () => { s.turnMinutes = Math.max(5, Math.min(240, Number(tm.value) || 45)); void redraw(); });
    box.append(h('div', { class: 'card' }, h('h3', null, 'Horas de los turnos'), h('p', { class: 'soft small' }, 'El Excel solo numera los turnos; la hora y duración son las que tú indicas.'), h('div', { class: 'row' }, 'Primer turno a las ', st, ' · cada turno dura ', tm, ' min')));
  }

  if (p.warnings.length) box.append(h('details', { open: true }, h('summary', null, `Avisos (${p.warnings.length})`), h('ul', { class: 'plain' }, p.warnings.map(tag))));

  const cell = (el: Node) => h('td', null, el);
  const inp = (val: string, onCh: (v: string) => void, label: string, type = 'text') => { const i = h('input', { type, 'aria-label': label }); i.value = val; i.addEventListener('change', () => onCh(i.value.trim())); return i; };
  // Asignaturas
  box.append(h('h2', { class: 'section-title' }, `Asignaturas (${p.subjects.length})`), h('div', { class: 'scroll-x' }, h('table', { class: 'prev' }, h('thead', null, h('tr', null, h('th', null, 'Símbolo'), h('th', null, 'Nombre'), h('th', null, 'Profesor'))),
    h('tbody', null, p.subjects.map((sb) => h('tr', null, h('td', null, h('strong', null, sb.symbol)), cell(inp(sb.name, (v) => { sb.name = v; }, 'Nombre de ' + sb.symbol)), cell((() => { const i = inp(sb.professor ?? '', (v) => { sb.professor = v || null; }, 'Profesor de ' + sb.symbol); i.placeholder = 'Sin nombre'; return i; })())))))));
  // Sesiones
  const opts = (sel: string | null) => [h('option', { value: '' }, '— elegir —'), ...p.subjects.map((x) => h('option', { value: x.symbol, selected: x.symbol === sel }, x.symbol))];
  box.append(h('h2', { class: 'section-title' }, `Clases (${p.sessions.length})`), h('div', { class: 'scroll-x' }, h('table', { class: 'prev' }, h('thead', null, h('tr', null, h('th', null, 'Sí'), h('th', null, 'Semana'), h('th', null, 'Fecha'), h('th', null, 'Asig.'), h('th', null, 'Turnos'), h('th', null, 'Horario'))),
    h('tbody', null, p.sessions.map((x) => {
      const cb = h('input', { type: 'checkbox', checked: x.include, 'aria-label': 'Incluir clase', style: 'width:22px;height:22px' }); cb.addEventListener('change', () => { x.include = cb.checked; });
      const sel = h('select', { 'aria-label': 'Asignatura de la clase' }, opts(x.matchedSymbol)); sel.addEventListener('change', () => { x.matchedSymbol = sel.value || null; });
      const hrs = () => { const t = turnRange(x.turnStart, x.turnEnd, s.startTime, s.turnMinutes); return `${t.start}–${t.end}`; };
      const hrsCell = h('td', null, hrs());
      const t1 = inp(String(x.turnStart), (v) => { x.turnStart = Math.max(1, parseInt(v) || 1); hrsCell.textContent = hrs(); }, 'Turno inicial'); const t2 = inp(String(x.turnEnd), (v) => { x.turnEnd = Math.max(x.turnStart, parseInt(v) || x.turnStart); hrsCell.textContent = hrs(); }, 'Turno final');
      t1.style.width = t2.style.width = '52px';
      return h('tr', null, cell(cb), h('td', null, x.week ?? '—'), cell(inp(x.date ?? '', (v) => { x.date = isISO(v) ? v : null; }, 'Fecha', 'date')), cell(sel), h('td', { style: 'white-space:nowrap' }, t1, ' – ', t2), hrsCell);
    })))));
  // Eventos
  if (p.events.length) box.append(h('h2', { class: 'section-title' }, `Eventos y períodos (${p.events.length})`), h('div', { class: 'scroll-x' }, h('table', { class: 'prev' }, h('thead', null, h('tr', null, h('th', null, 'Evento'), h('th', null, 'Inicio'), h('th', null, 'Fin'))),
    h('tbody', null, p.events.map((e) => h('tr', null, cell(inp(e.title, (v) => { e.title = v || e.title; }, 'Título')), cell(inp(e.startDate ?? '', (v) => { e.startDate = isISO(v) ? v : null; }, 'Inicio', 'date')), cell(inp(e.endDate ?? '', (v) => { e.endDate = isISO(v) ? v : null; }, 'Fin', 'date'))))))),
    h('p', { class: 'soft small' }, 'Los eventos sin fecha en el Excel quedan como "pendiente de confirmar" hasta que les asignes una.'));

  const bad = p.sessions.filter((x) => x.include && (!x.date || !x.matchedSymbol)).length;
  const problem = !ok ? 'Completa los datos del semestre.' : bad ? `Hay ${bad} clase${bad > 1 ? 's' : ''} sin fecha o sin asignatura: corrígelas o desmárcalas.` : !p.sessions.some((x) => x.include) ? 'No hay clases para importar.' : '';
  const go1 = h('button', { class: 'btn primary', type: 'button', disabled: !!problem || s.busy }, icon('check', 18), mt.semester ? 'Actualizar horario existente' : 'Crear e importar');
  go1.addEventListener('click', async () => {
    s.busy = true; go1.disabled = true;
    try {
      const r = await commitImport(p, { fileName: s.fileName, hash: s.hash, original: s.blob, startTime: s.startTime, turnMinutes: s.turnMinutes });
      await setActiveSemester(r.semesterId); s.result = r; toast('Importación completada'); await redraw(); window.scrollTo(0, 0);
    } catch (e) { s.busy = false; go1.disabled = false; reportError(e, 'No se pudo guardar la importación (no se modificó nada)'); }
  });
  box.append(h('div', { class: 'stack', style: 'margin-top:18px' }, problem ? h('div', { class: 'form-error', role: 'alert' }, problem) : null,
    h('div', { class: 'row' }, go1, h('button', { class: 'btn ghost', type: 'button', onClick: () => { S = null; err = null; go('#/horario'); } }, 'Cancelar'))));
  void fmtLong; void yearId; void semesterId;
}
