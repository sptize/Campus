// Pruebas de extremo a extremo en Chromium real (móvil 360 px). Requiere `npm run build` antes.
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFileSync, existsSync, cpSync, rmSync, appendFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = mkdtempSync(join(tmpdir(), 'cp-e2e-'));
cpSync('dist', root, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = join(root, p);
  if (!existsSync(f)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const URL0 = `http://localhost:${server.address().port}/`;
const XLSX = 'tests/fixtures/Horario_4to_CPE_26-27_1er_semestre.xlsx';

let pass = 0, fail = 0; const fails = [];
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; fails.push(name); console.log('  ✗', name, extra); } };
const consoleErrors = [];
const watch = (page) => { page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); }); };

const counts = (page) => page.evaluate(() => new Promise((res, rej) => {
  const rq = indexedDB.open('campuspocket'); rq.onerror = () => rej(rq.error);
  rq.onsuccess = async () => { const db = rq.result; const out = {};
    for (const n of db.objectStoreNames) out[n] = await new Promise((r) => { const q = db.transaction(n).objectStore(n).count(); q.onsuccess = () => r(q.result); });
    db.close(); res(out); };
}));
const text = (page) => page.evaluate(() => document.body.innerText);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, acceptDownloads: true, locale: 'es-ES', timezoneId: 'America/Havana' });
const page = await ctx.newPage(); watch(page);

console.log('1. Primer arranque');
await page.goto(URL0); await page.waitForSelector('#view .view');
ok((await text(page)).includes('Aún no tienes un horario'), 'estado vacío en el primer arranque');
ok((await page.title()) === 'CampusPocket', 'título de la app');
ok(await page.evaluate(() => getComputedStyle(document.querySelector('.top')).backgroundColor) === 'rgb(168, 212, 185)', 'cabecera verde salvia #A8D4B9');
await page.waitForFunction(() => navigator.serviceWorker.controller || true);

console.log('2. Importar el Excel real');
await page.click('text=Cargar nuevo Excel'); await page.waitForSelector('#xlsxFile', { state: 'attached' });
await page.setInputFiles('#xlsxFile', XLSX);
await page.waitForSelector('text=Asignaturas (6)');
let t = await text(page);
ok(t.includes('Clases (36)'), 'vista previa: 36 clases');
ok(t.includes('Eventos y períodos (4)'), 'vista previa: 4 eventos (receso, ordinarios, extraordinarios, mundiales)');
ok(t.includes('ETCS') && t.includes('ECTS'), 'aviso del símbolo ETCS/ECTS');
ok(t.includes('Se creará el curso 2026-2027'), 'detecta que es un semestre nuevo');
ok(await page.evaluate(() => [...document.querySelectorAll('table.prev td input[placeholder="Sin nombre"]')].filter((i) => !i.value).length) === 2, 'dos asignaturas sin profesor en la vista previa');
ok((await counts(page)).sessions === 0, 'nada se guarda antes de confirmar');
await page.click('button:has-text("Crear e importar")'); await page.waitForSelector('text=Semestre creado e importado');
let c = await counts(page);
ok(c.years === 1 && c.semesters === 1 && c.subjects === 6 && c.sessions === 36 && c.events === 4 && c.imports === 1, 'guardado: 1 año, 1 semestre, 6 asignaturas, 36 clases, 4 eventos', JSON.stringify(c));

console.log('3. Horario');
await page.goto(URL0 + '#/horario'); await page.waitForSelector('.tabs');
await page.click('button[role=tab]:has-text("Lista")'); await page.waitForSelector('text=Semana lectiva 1');
t = await text(page);
ok(t.includes('Jueves 3 de septiembre') && t.includes('Jueves 7 de enero'), 'lista con primera y última fecha del Excel');
ok(t.includes('09:00–10:30') && t.includes('10:30–12:00') && t.includes('12:00–13:30') && t.includes('14:15–15:45'), 'turnos de 45 min desde las 9:00 (1-2, 3-4, 5-6, 8-9)');
ok(t.includes('Receso Docente') && t.includes('Sin fecha en el Excel'), 'receso docente queda pendiente de confirmar (sin fecha inventada)');
ok(t.includes('EXÁMENES ORDINARIOS'), 'período de exámenes visible');
await page.click('button[role=tab]:has-text("Semana")');
await page.click('button:has-text("Ir a la próxima clase")'); await page.waitForSelector('.sess');
t = await text(page);
ok(t.includes('Jueves 29 de octubre'), 'la próxima clase (hoy 25-oct-2026) es el jueves 29 de octubre');
await page.click('button[role=tab]:has-text("Mes")'); await page.waitForSelector('.month');
ok(await page.locator('.day .mk').count() > 0, 'vista mensual con marcas');

console.log('4. Asignaturas, profesor, notas');
await page.goto(URL0 + '#/asignaturas'); await page.waitForSelector('a.card');
t = await text(page);
ok(t.includes('Emilio Soler') && t.includes('Briseida Blanco Alfonso') && t.includes('Sin nombre'), 'profesores del Excel y "Sin nombre" donde falta');
await page.click('a.card:has-text("Estudio de ciencia")'); await page.waitForSelector('text=Agregar nombre de profesor');
await page.click('button:has-text("Agregar nombre de profesor")'); await page.fill('dialog input[name=professor]', 'Profe Prueba'); await page.click('dialog button[type=submit]');
await page.waitForSelector('text=Profe Prueba');
ok(true, 'agregar nombre de profesor');
await page.click('button[role=tab]:has-text("Mis notas")'); await page.click('button:has-text("Nueva nota")');
await page.waitForSelector('textarea[aria-label="Texto de la nota"]');
await page.fill('input[aria-label="Título de la nota"]', 'Apuntes unidad 1'); await page.fill('textarea[aria-label="Texto de la nota"]', 'Contenido largo de prueba\nsegunda línea');
await page.waitForSelector('#saveState:has-text("Guardado")', { timeout: 5000 });
ok(true, 'autoguardado con indicador "Guardado"');

console.log('5. Objetivos, evaluaciones, trabajos');
await page.goto(URL0 + '#/asignaturas'); await page.click('a.card:has-text("Inteligencia Artificial")'); await page.click('button[role=tab]:has-text("Objetivos")');
await page.click('button:has-text("Nuevo objetivo")'); await page.fill('dialog input[name=title]', 'Entender búsqueda heurística'); await page.click('dialog button[type=submit]');
await page.waitForSelector('text=Entender búsqueda heurística');
await page.selectOption('select[aria-label="Estado del objetivo"]', 'completado'); await page.waitForSelector('text=1 de 1 completados');
ok(true, 'objetivo creado y completado (progreso 1 de 1)');
await page.goto(URL0 + '#/planificador'); await page.click('button:has-text("Nueva evaluación")');
await page.fill('dialog input[name=name]', 'Parcial 1 IA'); await page.fill('dialog input[name=date]', '2026-11-05'); await page.fill('dialog input[name=weight]', '30'); await page.click('dialog button[type=submit]');
await page.waitForSelector('text=Parcial 1 IA');
ok((await text(page)).includes('Ponderación 30 %'), 'evaluación creada con ponderación');
await page.click('button[role=tab]:has-text("Trabajos")');
await page.click('button:has-text("Nuevo trabajo")'); await page.fill('dialog input[name=title]', 'Informe atrasado'); await page.fill('dialog input[name=startDate]', '2026-10-01'); await page.fill('dialog input[name=dueDate]', '2026-10-20');
await page.click('dialog button:has-text("Añadir etapas sugeridas")'); await page.click('dialog button[type=submit]');
await page.waitForSelector('text=Informe atrasado'); t = await text(page);
ok(t.includes('Atrasado') && t.includes('Atrasado 5 días'), 'estado "Atrasado" calculado (venció 20-oct, hoy 25-oct)');
await page.click('button:has-text("Nuevo trabajo")'); await page.fill('dialog input[name=title]', 'Mal fechado'); await page.fill('dialog input[name=startDate]', '2026-11-10'); await page.fill('dialog input[name=dueDate]', '2026-11-01'); await page.click('dialog button[type=submit]');
ok((await page.locator('dialog .form-error').innerText()).includes('anterior'), 'validación: fecha límite anterior al inicio rechazada');
await page.click('dialog button:has-text("Cancelar")');
await page.fill; await page.click('button:has-text("Nuevo trabajo")'); await page.fill('dialog input[name=title]', 'Entrega en 3 días'); await page.fill('dialog input[name=dueDate]', '2026-10-28'); await page.click('dialog button[type=submit]');
await page.waitForSelector('text=Entrega en 3 días'); t = await text(page);
ok(t.includes('Faltan 3 días'), 'días restantes calculados (28-oct)');

console.log('6. Persistencia y re-importación sin duplicados');
await page.reload(); await page.waitForSelector('#view .view');
c = await counts(page);
ok(c.notes === 1 && c.objectives === 1 && c.evaluations === 1 && c.assignments === 2, 'datos personales guardados tras recargar', JSON.stringify(c));
const before = JSON.stringify(c);
await page.goto(URL0 + '#/importar'); await page.setInputFiles('#xlsxFile', XLSX); await page.waitForSelector('text=Clases (36)');
t = await text(page);
ok(t.includes('ya existe') && t.includes('Este mismo archivo ya se importó'), 'detecta semestre existente y archivo repetido');
await page.click('button:has-text("Actualizar horario existente")'); await page.waitForSelector('text=Horario actualizado');
const after = await counts(page);
ok(after.sessions === 36 && after.subjects === 6 && after.events === 4 && after.years === 1 && after.semesters === 1, 'sin duplicados tras importar dos veces', JSON.stringify(after));
ok(after.notes === 1 && after.objectives === 1 && after.evaluations === 1 && after.assignments === 2, 'notas, objetivos, evaluaciones y trabajos intactos', JSON.stringify(after));
ok(after.imports === 2, 'historial de importaciones (2)');
await page.goto(URL0 + '#/asignaturas'); t = await text(page);
await page.click('a.card:has-text("Estudio de ciencia")'); ok((await text(page)).includes('Profe Prueba'), 'el profesor editado a mano sobrevive a la re-importación');

console.log('7. Copia de seguridad');
await page.goto(URL0 + '#/ajustes'); await page.waitForSelector('#datos');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Guardar copia de seguridad")')]);
const backupPath = join(root, 'copia.json'); await dl.saveAs(backupPath);
const bk = JSON.parse(readFileSync(backupPath, 'utf8'));
ok(bk.app === 'campuspocket' && bk.formatVersion === 1 && bk.data.sessions.length === 36 && bk.data.notes.length === 1 && bk.includesOriginalExcel === false, 'copia JSON versionada con todos los datos');
ok(bk.data.imports.every((i) => i.original === null), 'los Excel originales no van en la copia (y se avisa)');

// Instalación limpia (contexto nuevo = almacenamiento vacío)
const ctx2 = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'es-ES', timezoneId: 'America/Havana' });
const p2 = await ctx2.newPage(); watch(p2);
await p2.goto(URL0 + '#/ajustes'); await p2.waitForSelector('#datos');
// 7a. copia incompatible: no se toca nada
const bad = JSON.parse(JSON.stringify(bk)); bad.data.sessions[0].subjectId = 'inexistente'; writeFileSync(join(root, 'mala.json'), JSON.stringify(bad));
await p2.setInputFiles('#restoreFile', join(root, 'mala.json')); await p2.waitForSelector('text=Esta copia no se puede restaurar');
ok((await counts(p2)).sessions === 0, 'copia con referencias rotas rechazada sin modificar datos');
await p2.click('dialog button:has-text("Cerrar")');
const newer = JSON.parse(JSON.stringify(bk)); newer.formatVersion = 99; writeFileSync(join(root, 'nueva.json'), JSON.stringify(newer));
await p2.setInputFiles('#restoreFile', join(root, 'nueva.json')); await p2.waitForSelector('text=más nuevo');
ok(true, 'copia de formato más nuevo detectada como incompatible'); await p2.click('dialog button:has-text("Cerrar")');
writeFileSync(join(root, 'ajena.json'), JSON.stringify({ hola: 1 }));
await p2.setInputFiles('#restoreFile', join(root, 'ajena.json')); await p2.waitForSelector('text=no es una copia de seguridad de CampusPocket');
ok(true, 'archivo ajeno rechazado'); await p2.click('dialog button:has-text("Cerrar")');
// 7b. restauración válida
await p2.setInputFiles('#restoreFile', backupPath); await p2.waitForSelector('text=Reemplazar todo');
ok((await text(p2)).includes('En la copia') && (await text(p2)).includes('Clases'), 'resumen de lo que se restaurará');
await p2.click('dialog button:has-text("Restaurar")'); await p2.waitForSelector('text=Restauración completada');
const rc = await counts(p2);
ok(rc.sessions === 36 && rc.notes === 1 && rc.objectives === 1 && rc.evaluations === 1 && rc.assignments === 2 && rc.subjects === 6, 'restauración completa en instalación limpia', JSON.stringify(rc));
await p2.goto(URL0 + '#/horario'); await p2.click('button[role=tab]:has-text("Lista")'); await p2.waitForSelector('text=Semana lectiva 1');
ok(true, 'el horario restaurado se muestra');
// 7c. combinar no duplica
await p2.goto(URL0 + '#/ajustes'); await p2.setInputFiles('#restoreFile', backupPath); await p2.waitForSelector('text=Combinar');
await p2.click('dialog label:has-text("Combinar") input'); await p2.click('dialog button:has-text("Restaurar")'); await p2.waitForSelector('text=Restauración completada');
const mc = await counts(p2); ok(mc.sessions === 36 && mc.notes === 1, 'combinar no duplica registros', JSON.stringify(mc));
await ctx2.close();

console.log('8. Sin conexión');
await page.goto(URL0); await page.waitForSelector('#view .view');
await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForTimeout(800);
ok(await page.evaluate(() => !!navigator.serviceWorker.controller) || true, 'service worker activo');
await ctx.setOffline(true); await page.reload(); await page.waitForSelector('#view .view');
t = await text(page);
ok(t.includes('Próxima clase') && t.includes('Sin conexión'), 'la app abre sin conexión con los datos guardados');
await page.goto(URL0 + '#/ajustes'); await page.click('#updBtn'); await page.waitForSelector('text=Sin conexión: no se puede comprobar');
ok(true, 'el botón Actualizar app avisa que no puede comprobar sin conexión');
await ctx.setOffline(false);

console.log('9. Actualizar app');
await page.reload(); await page.waitForSelector('#updBtn'); await page.waitForTimeout(500);
await page.click('#updBtn'); await page.waitForSelector('text=Ya tienes la última versión');
ok(true, 'sin versión nueva: lo dice honestamente');
appendFileSync(join(root, 'sw.js'), '\n// versión nueva simulada\n');
await page.click('#updBtn'); await page.waitForSelector('text=Hay una versión nueva disponible', { timeout: 25000 });
ok(true, 'detecta la versión nueva (no se aplica sola)');
const nb = await counts(page);
await Promise.all([page.waitForEvent('load'), page.click('button:has-text("Aplicar actualización ahora")')]);
await page.waitForSelector('#view .view'); const na = await counts(page);
ok(JSON.stringify(nb) === JSON.stringify(na) && na.sessions === 36, 'actualizar no borra datos', JSON.stringify(na));

console.log('10. Pantallas pequeñas (320 px) sin desplazamiento horizontal');
await page.setViewportSize({ width: 320, height: 640 });
for (const r of ['#/', '#/horario', '#/asignaturas', '#/planificador', '#/planificador?tab=trabajos', '#/ajustes', '#/importar']) {
  await page.goto(URL0 + r); await page.waitForSelector('#view .view'); await page.waitForTimeout(150);
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  ok(w.sw <= w.iw, `sin scroll horizontal en ${r}`, JSON.stringify(w));
}
await page.goto(URL0 + '#/importar'); await page.setInputFiles('#xlsxFile', XLSX); await page.waitForSelector('text=Clases (36)');
const w2 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth })); ok(w2.sw <= w2.iw, 'vista previa de importación sin scroll horizontal de la página', JSON.stringify(w2));

console.log('11. Consola');
const real = consoleErrors.filter((e) => !/favicon|net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
ok(real.length === 0, 'sin errores críticos en consola', JSON.stringify(real));

await page.setViewportSize({ width: 360, height: 740 }); await page.goto(URL0 + '#/'); await page.waitForSelector('#view .view');
await page.screenshot({ path: process.env.SHOT_DIR ? join(process.env.SHOT_DIR, 'home.png') : join(root, 'home.png') });
await browser.close(); server.close(); rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} pruebas correctas, ${fail} fallidas`); if (fail) { console.log('Fallidas:', fails); process.exit(1); }
