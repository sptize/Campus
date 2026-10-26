import './styles/main.css';
import { buildShell, updateHeader } from './app/shell';
import { route, refresh, onRendered } from './app/router';
import { registerServiceWorker } from './app/pwa';
import { homeView } from './features/home';
import { scheduleView } from './features/schedule';
import { subjectsView, subjectDetail } from './features/subjects';
import { plannerView } from './features/planner';
import { settingsView } from './features/settings';
import { importView } from './features/import';
import { reportError } from './ui/modal';

window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'Error inesperado'));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'Error inesperado'));

buildShell();
route(/^\/$/, 'inicio', homeView);
route(/^\/horario$/, 'horario', scheduleView);
route(/^\/asignaturas$/, 'asignaturas', subjectsView);
route(/^\/asignaturas\/(.+)$/, 'asignaturas', subjectDetail);
route(/^\/planificador$/, 'planificador', plannerView);
route(/^\/ajustes$/, 'ajustes', settingsView);
route(/^\/importar$/, 'horario', importView);
onRendered((nav) => { void updateHeader(nav); });
registerServiceWorker();
// Pide almacenamiento persistente para reducir el riesgo de que el navegador borre los datos.
void navigator.storage?.persist?.().catch(() => {});
void refresh(false);
