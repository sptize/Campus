import { activeSemester, loadSemData } from '../services/queries';
import type { SemData } from '../services/calendar';
import type { Semester, Year } from '../db/types';
export interface Ctx { sem: Semester; year: Year; data: SemData }
export async function loadActive(): Promise<Ctx | null> {
  const a = await activeSemester(); if (!a) return null;
  return { ...a, data: await loadSemData(a.sem) };
}
