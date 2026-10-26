// Guarda en IndexedDB una vista previa ya revisada. Todo ocurre en UNA transacción.
import { years, semesters, subjects, sessions, events, imports, transact } from '../db/idb';
import type { Year, Semester, Subject, Session, SpecialEvent, ImportRecord } from '../db/types';
import { norm, symKey, type ImportPreview } from './importer';

const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const yearId = (career: string, course: string) => `yr_${slug(career)}_${course}`;
export const semesterId = (yid: string, n: number) => `sem_${yid}_${n}`;

export interface MatchInfo { year: Year | null; semester: Semester | null; sameFile: ImportRecord | null }

export async function findMatch(p: ImportPreview, hash: string): Promise<MatchInfo> {
  const yid = yearId(p.meta.career, p.meta.course);
  const year = (await years.get(yid)) ?? null;
  const semester = year && p.meta.semester !== null ? (await semesters.get(semesterId(yid, p.meta.semester))) ?? null : null;
  const sameFile = (await imports.where('hash', hash))[0] ?? null;
  return { year, semester, sameFile };
}

export interface CommitOptions { fileName: string; hash: string; original: Blob | null; startTime: string; turnMinutes: number }
export interface CommitResult { yearId: string; semesterId: string; createdSemester: boolean; subjects: number; sessions: number; events: number; skipped: number }

export async function commitImport(p: ImportPreview, o: CommitOptions): Promise<CommitResult> {
  if (p.meta.semester === null || !p.meta.career || !p.meta.course) throw new Error('Faltan carrera, curso o semestre para guardar la importación.');
  return transact([years, semesters, subjects, sessions, events, imports], async () => {
    const now = Date.now();
    const yid = yearId(p.meta.career, p.meta.course);
    if (!(await years.get(yid))) await years.put({ id: yid, career: p.meta.career, course: p.meta.course, level: p.meta.level, createdAt: now });
    const sid = semesterId(yid, p.meta.semester!);
    let sem = await semesters.get(sid);
    const created = !sem;
    if (!sem) sem = { id: sid, yearId: yid, number: p.meta.semester!, group: p.meta.group, room: p.meta.room, faculty: p.meta.faculty, courseType: p.meta.courseType, startTime: o.startTime, turnMinutes: o.turnMinutes, sourceName: o.fileName, importedAt: now, createdAt: now };
    else sem = { ...sem, group: sem.group || p.meta.group, room: sem.room || p.meta.room, faculty: sem.faculty || p.meta.faculty, courseType: sem.courseType || p.meta.courseType, sourceName: o.fileName, importedAt: now };
    await semesters.put(sem);

    // Asignaturas: se conservan los ids (y por tanto notas, objetivos, etc.) y lo editado a mano.
    const existingSubjects = await subjects.where('semesterId', sid);
    const idBySymbol = new Map<string, string>();
    let colorIdx = existingSubjects.length;
    for (const s of p.subjects) {
      const id = `sub_${sid}_${symKey(s.symbol)}`;
      idBySymbol.set(s.symbol, id);
      const prev = existingSubjects.find((x) => x.id === id);
      const next: Subject = prev
        ? { ...prev, name: prev.edited ? prev.name : s.name, professor: prev.edited ? prev.professor : s.professor, category: s.category ?? prev.category }
        : { id, semesterId: sid, code: s.symbol, name: s.name, professor: s.professor, category: s.category, colorIndex: colorIdx++, observations: '', source: 'import', edited: false, createdAt: now };
      await subjects.put(next);
    }

    // Sesiones: se reemplazan las importadas sin tocar; lo manual o editado se respeta.
    const prevSessions = await sessions.where('semesterId', sid);
    const protectedIds = new Set(prevSessions.filter((x) => x.source === 'manual' || x.edited).map((x) => x.id));
    await sessions.bulkDelete(prevSessions.filter((x) => !protectedIds.has(x.id)).map((x) => x.id));
    const newSessions: Session[] = []; let skipped = 0;
    for (const s of p.sessions) {
      if (!s.include || !s.date || !s.matchedSymbol || !idBySymbol.has(s.matchedSymbol)) { skipped++; continue; }
      const id = `ses_${sid}_${s.date}_${s.turnStart}_${symKey(s.matchedSymbol)}`;
      if (protectedIds.has(id) || newSessions.some((x) => x.id === id)) continue;
      newSessions.push({ id, semesterId: sid, subjectId: idBySymbol.get(s.matchedSymbol)!, symbol: s.matchedSymbol, date: s.date, week: s.week, turnStart: s.turnStart, turnEnd: s.turnEnd, room: sem.room, partial: s.partial, source: 'import', edited: false });
    }
    await sessions.bulkPut(newSessions);

    const prevEvents = await events.where('semesterId', sid);
    const protectedEv = new Set(prevEvents.filter((x) => x.source === 'manual' || x.edited).map((x) => x.id));
    await events.bulkDelete(prevEvents.filter((x) => !protectedEv.has(x.id)).map((x) => x.id));
    const newEvents: SpecialEvent[] = [];
    for (const e of p.events) {
      const id = `evt_${sid}_${e.kind}_${slug(e.title)}_${e.startDate ?? 'sem' + (e.week ?? 'x')}`;
      if (protectedEv.has(id) || newEvents.some((x) => x.id === id)) continue;
      newEvents.push({ id, semesterId: sid, kind: e.kind, title: e.title, week: e.week, startDate: e.startDate, endDate: e.endDate, source: 'import', edited: false });
    }
    await events.bulkPut(newEvents);

    await imports.put({ id: `imp_${now}_${o.hash.slice(0, 8)}`, semesterId: sid, fileName: o.fileName, hash: o.hash, importedAt: now, subjects: p.subjects.length, sessions: newSessions.length, events: newEvents.length, mode: created ? 'nuevo' : 'actualizacion', original: o.original });
    return { yearId: yid, semesterId: sid, createdSemester: created, subjects: p.subjects.length, sessions: newSessions.length, events: newEvents.length, skipped };
  });
}
