export type ID = string;
export type Source = 'import' | 'manual';
export type Priority = 'alta' | 'media' | 'baja';

export interface Year { id: ID; career: string; course: string; level: string; createdAt: number }
export interface Semester {
  id: ID; yearId: ID; number: number; group: string; room: string; faculty: string; courseType: string;
  startTime: string; turnMinutes: number; sourceName: string | null; importedAt: number | null; createdAt: number;
}
export interface Subject {
  id: ID; semesterId: ID; code: string; name: string; professor: string | null; category: string | null;
  colorIndex: number; observations: string; source: Source; edited: boolean; createdAt: number;
}
export interface Session {
  id: ID; semesterId: ID; subjectId: ID | null; symbol: string; date: string; week: number | null;
  turnStart: number; turnEnd: number; room: string; partial: boolean; source: Source; edited: boolean;
}
export type EventKind = 'receso' | 'examen_ordinario' | 'examen_extra' | 'mundiales' | 'otro';
export interface SpecialEvent {
  id: ID; semesterId: ID; kind: EventKind; title: string; week: number | null;
  startDate: string | null; endDate: string | null; source: Source; edited: boolean;
}
export interface Note { id: ID; subjectId: ID; semesterId: ID; title: string; body: string; createdAt: number; updatedAt: number }
export interface Objective {
  id: ID; subjectId: ID; semesterId: ID; scope: 'general' | 'especifico'; title: string; description: string;
  dueDate: string | null; priority: Priority; status: 'pendiente' | 'en_curso' | 'completado'; observations: string;
  evaluationId: ID | null; assignmentId: ID | null; createdAt: number; updatedAt: number;
}
export type EvalType = 'parcial' | 'final' | 'seminario' | 'trabajo' | 'practica' | 'proyecto' | 'otra';
export type EvalStatus = 'pendiente' | 'preparacion' | 'realizada' | 'calificada';
export interface Evaluation {
  id: ID; subjectId: ID; semesterId: ID; name: string; type: EvalType; typeLabel: string; date: string | null; time: string;
  topics: string; weight: number | null; grade: number | null; status: EvalStatus; observations: string;
  createdAt: number; updatedAt: number;
}
export interface Subtask { id: ID; title: string; done: boolean }
export type AsgStatus = 'pendiente' | 'en_curso' | 'completado' | 'entregado';
export interface Assignment {
  id: ID; subjectId: ID; semesterId: ID; title: string; description: string; startDate: string | null;
  dueDate: string | null; plannedFinish: string | null; priority: Priority; status: AsgStatus;
  estimatedHours: number | null; spentHours: number | null; links: string[]; observations: string;
  deliveredDate: string | null; subtasks: Subtask[]; createdAt: number; updatedAt: number;
}
export interface ImportRecord {
  id: ID; semesterId: ID; fileName: string; hash: string; importedAt: number;
  subjects: number; sessions: number; events: number; mode: 'nuevo' | 'actualizacion'; original: Blob | null;
}
export interface Setting { key: string; value: unknown }
