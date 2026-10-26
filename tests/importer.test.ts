import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSchedule } from '../src/services/importer';
import { readWorkbook } from '../src/services/xlsx';
import { parseSpanishDate, turnRange, weekdayMatches } from '../src/services/dates';

const file = readFileSync('tests/fixtures/Horario_4to_CPE_26-27_1er_semestre.xlsx');
const bytes = new Uint8Array(file);

test('metadatos del Excel real', async () => {
  const p = await parseSchedule(bytes);
  assert.equal(p.meta.career, 'Ing. Informática');
  assert.equal(p.meta.course, '2026-2027');
  assert.equal(p.meta.semester, 1);
  assert.equal(p.meta.group, 'Info-35');
  assert.equal(p.meta.room, 'A 34');
  assert.equal(p.meta.level, '4to');
  assert.equal(p.meta.faculty, 'Facultad Ciencias Técnicas');
});

test('asignaturas y profesores (sin inventar)', async () => {
  const p = await parseSchedule(bytes);
  assert.equal(p.subjects.length, 6);
  const by = Object.fromEntries(p.subjects.map((s) => [s.symbol, s]));
  assert.equal(by.IR.professor, 'Emilio Soler');
  assert.equal(by.SO.professor, 'Alejandro Santana');
  assert.equal(by.IA.professor, 'Orlenys Machin');
  assert.equal(by.MI.professor, 'Briseida Blanco Alfonso');
  assert.equal(by.ECTS.professor, null);
  assert.equal(by.Optv.professor, null);
});

test('sesiones: fechas, turnos combinados y alias ETCS→ECTS', async () => {
  const p = await parseSchedule(bytes);
  const week1 = p.sessions.filter((s) => s.date === '2026-09-03').map((s) => `${s.matchedSymbol}:${s.turnStart}-${s.turnEnd}`);
  assert.deepEqual(week1, ['ECTS:1-2', 'IR:3-4', 'IA:5-6', 'SO:8-9']);
  const jan = p.sessions.filter((s) => s.date === '2027-01-07').map((s) => s.matchedSymbol);
  assert.deepEqual(jan, ['MI', 'IR', 'IA', 'SO']);
  assert.ok(p.sessions.every((s) => s.date && s.matchedSymbol));
  assert.ok(p.warnings.some((w) => w.text.includes('ETCS')));
  const dates = [...new Set(p.sessions.map((s) => s.date))];
  assert.equal(dates.length, 9);
  assert.equal(p.sessions.length, 36);
});

test('eventos: receso sin fecha, exámenes con rango', async () => {
  const p = await parseSchedule(bytes);
  const r = p.events.find((e) => e.kind === 'receso')!;
  assert.equal(r.startDate, null);
  const o = p.events.find((e) => e.kind === 'examen_ordinario')!;
  assert.equal(o.startDate, '2027-01-18'); assert.equal(o.endDate, '2027-01-23');
  const x = p.events.find((e) => e.kind === 'examen_extra')!;
  assert.equal(x.startDate, '2027-01-25'); assert.equal(x.endDate, '2027-01-30');
  assert.equal(p.events.find((e) => e.kind === 'mundiales')!.startDate, '2027-02-01');
  assert.equal(p.events.length, 4);
});

test('fechas: erratas del Excel y jueves reales', async () => {
  assert.equal(parseSpanishDate('juves 15 oct', '2026-2027').start, '2026-10-15');
  assert.equal(parseSpanishDate('jueves 1ero oct', '2026-2027').start, '2026-10-01');
  assert.equal(parseSpanishDate('jueves 7 enero', '2026-2027').start, '2027-01-07');
  assert.equal(parseSpanishDate('abc', '2026-2027').ok, false);
  assert.equal(parseSpanishDate('jueves 3 sept', null).ok, false);
  assert.ok(weekdayMatches('2026-09-03', 'jueves'));
  const p = await parseSchedule(bytes);
  assert.ok(![...new Set(p.sessions.map((s) => s.date!))].some((d) => !weekdayMatches(d, 'jueves')));
});

test('turnos de 45 min desde las 9:00', () => {
  assert.deepEqual(turnRange(1, 2, '09:00', 45), { start: '09:00', end: '10:30' });
  assert.deepEqual(turnRange(3, 4, '09:00', 45), { start: '10:30', end: '12:00' });
  assert.deepEqual(turnRange(5, 6, '09:00', 45), { start: '12:00', end: '13:30' });
  assert.deepEqual(turnRange(8, 9, '09:00', 45), { start: '14:15', end: '15:45' });
});

test('archivos malformados se rechazan con mensaje claro', async () => {
  await assert.rejects(() => readWorkbook(new Uint8Array([1, 2, 3, 4, 5])), /no es un libro de Excel/);
  await assert.rejects(() => readWorkbook(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0])), /\.xls/);
  const broken = bytes.slice(0, 3000);
  await assert.rejects(() => readWorkbook(broken));
  await assert.rejects(() => parseSchedule(new Uint8Array(0)));
});
