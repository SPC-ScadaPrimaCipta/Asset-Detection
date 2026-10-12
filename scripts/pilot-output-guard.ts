// Komentar penjelas logika: guard eksklusif untuk pilot, tidak mengubah produksi
import { promises as fs, constants } from 'fs';
import { join } from 'path';

// Status reservasi: reserved / running / succeeded / failed
// File reservasi (run.lock) bukan artefak hasil discovery.
export type ReservationStatus = 'reserved' | 'running' | 'succeeded' | 'failed';

export interface ReserveResult {
  reserved: boolean;
  path: string; // path hasil (bukan reservasi)
  reservationPath: string;
  status: ReservationStatus;
  runId: string;
  message?: string;
}

export function makeRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function reserveTarget(outputDir: string, runId: string): Promise<ReserveResult> {
  const reservationPath = join(outputDir, '.reservation');
  const lockPath = join(outputDir, 'run.lock');

  // 1. Periksa konflik sebelum request API (titik 2)
  try {
    await fs.access(outputDir + '/discovery-result.json', constants.F_OK);
    return { reserved: false, path: join(outputDir, 'discovery-result.json'), reservationPath: lockPath, status: 'failed', runId, message: 'Target output sudah ada; berhenti sebelum API' };
  } catch { /* tidak ada — lanjut */ }

  // 2. Reservasi eksklusif (titik 3: create-only / exclusive)
  try {
    const fd = await fs.open(lockPath, 'wx');
    await fd.write(JSON.stringify({ runId, status: 'reserved', startedAt: new Date().toISOString() }) + '\n', 0, 'utf8');
    await fd.close();
  } catch (e: any) {
    return { reserved: false, path: join(outputDir, 'discovery-result.json'), reservationPath: lockPath, status: 'failed', runId, message: 'Gagal reservasi eksklusif; mungkin sudah dipesan' + (e?.message ? ': ' + e.message : '') };
  }

  return { reserved: true, path: join(outputDir, 'discovery-result.json'), reservationPath: lockPath, status: 'reserved', runId };
}

// 3. Penulisan eksklusif tanpa overwrite (titik 3 lanjutan)
export async function writeExclusive(targetPath: string, data: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const fd = await fs.open(targetPath, 'wx');
    await fd.write(data, 0, 'utf8');
    await fd.close();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, message: 'Write exclusive gagal (mungkin sudah ada setelah check): ' + (e?.message || String(e)) };
  }
}

// 4. Status akhir (titik 4)
export async function finalizeReservation(lockPath: string, status: ReservationStatus, runId: string) {
  try {
    await fs.writeFile(lockPath, JSON.stringify({ runId, status, completedAt: new Date().toISOString(), isArtifact: false }) + '\n');
  } catch { /* abaikan — bukan artefak hasil */ }
}
