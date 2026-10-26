import { years, semesters, subjects, sessions, events, evaluations, assignments, objectives, notes, getSetting, setSetting } from '../db/idb';
import type { Semester, Year } from '../db/types';
import type { SemData } from './calendar';

export async function allSemesters(): Promise<{ sem: Semester; year: Year }[]> {
  const ys = new Map((await years.all()).map((y) => [y.id, y]));
  return (await semesters.all()).filter((s) => ys.has(s.yearId)).map((sem) => ({ sem, year: ys.get(sem.yearId)! }))
    .sort((a, b) => b.year.course.localeCompare(a.year.course) || b.sem.number - a.sem.number);
}
export async function activeSemester(): Promise<{ sem: Semester; year: Year } | null> {
  const list = await allSemesters();
  if (!list.length) return null;
  const id = await getSetting<string | null>('activeSemesterId', null);
  return list.find((x) => x.sem.id === id) ?? list[0];
}
export const setActiveSemester = (id: string) => setSetting('activeSemesterId', id);

export async function loadSemData(sem: Semester): Promise<SemData> {
  const [s, ss, ev, evs, as, ob] = await Promise.all([
    subjects.where('semesterId', sem.id), sessions.where('semesterId', sem.id), events.where('semesterId', sem.id),
    evaluations.where('semesterId', sem.id), assignments.where('semesterId', sem.id), objectives.where('semesterId', sem.id),
  ]);
  return { sem, subjects: s.sort((a, b) => a.colorIndex - b.colorIndex), sessions: ss, events: ev, evaluations: evs, assignments: as, objectives: ob };
}
export { notes };

/** Borra un semestre y todo lo que cuelga de él, en una sola transacción. */
export async function deleteSemesterCascade(semId: string) {
  const { transact, imports } = await import('../db/idb');
  await transact([semesters, subjects, sessions, events, notes, objectives, evaluations, assignments, imports], async () => {
    for (const t of [subjects, sessions, events, notes, objectives, evaluations, assignments, imports] as const) {
      const rows = await (t as any).where('semesterId', semId);
      await (t as any).bulkDelete(rows.map((r: any) => r.id));
    }
    await semesters.delete(semId);
  });
}
export async function deleteYearCascade(yearId: string) {
  for (const s of await semesters.where('yearId', yearId)) await deleteSemesterCascade(s.id);
  await years.delete(yearId);
}
