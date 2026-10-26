import { buildBackup, backupFileName, markBackupDone } from '../services/backup';
import { toast, reportError } from '../ui/modal';

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function exportNow(quiet = false): Promise<boolean> {
  try {
    const file = await buildBackup();
    downloadBlob(new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }), backupFileName());
    await markBackupDone();
    if (!quiet) toast('Copia guardada en tu dispositivo (carpeta de descargas).');
    return true;
  } catch (e) { reportError(e, 'No se pudo crear la copia'); return false; }
}
