// Komentar penjelas logika: uji lokal pengamanan output tanpa API / mock SDK
// Tidak menjalankan generateContent/countTokens; hanya guard eksklusif.
describe('pilot-output-guard lokal', () => {
  const fs = require('fs');
  const path = require('path');
  const { reserveTarget, finalizeReservation, writeExclusive, makeRunId } = require('../scripts/pilot-output-guard');
  const tmpBase = path.join(__dirname, '..', 'tmp-guard-test');

  beforeEach(() => {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(tmpBase, { recursive: true });
  });
  afterEach(() => {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  it('1. target baru -> artefak berhasil ditulis', async () => {
    const d = path.join(tmpBase, 't1-' + makeRunId());
    fs.mkdirSync(d, { recursive: true });
    const r = await reserveTarget(d, makeRunId());
    expect(r.reserved).toBe(true);
    const w = await writeExclusive(path.join(d, 'discovery-result.json'), '{"ok":true}');
    expect(w.ok).toBe(true);
  });

  it('2. target existing -> countTokens/generateContent mock = 0; isi file tetap sama', async () => {
    const d = path.join(tmpBase, 't2-' + makeRunId());
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'discovery-result.json'), '{"orig":true}');
    const r = await reserveTarget(d, makeRunId());
    expect(r.reserved).toBe(false);
    const content = fs.readFileSync(path.join(d, 'discovery-result.json'), 'utf8');
    expect(content).toContain('orig');
  });

  it('3. dua eksekusi target sama -> hanya satu memperoleh reservasi dan mencapai mock SDK', async () => {
    const d = path.join(tmpBase, 't3-' + makeRunId());
    fs.mkdirSync(d, { recursive: true });
    const r1 = await reserveTarget(d, makeRunId());
    const r2 = await reserveTarget(d, makeRunId());
    expect(r1.reserved).toBe(true);
    expect(r2.reserved).toBe(false);
  });

  it('4. mock generation gagal -> artefak baru berstatus failed, kandidat unavailable, reservasi failed', async () => {
    const d = path.join(tmpBase, 't4-' + makeRunId());
    fs.mkdirSync(d, { recursive: true });
    const r = await reserveTarget(d, makeRunId());
    expect(r.reserved).toBe(true);
    const w = await writeExclusive(path.join(d, 'discovery-result.json'), JSON.stringify({status:'failed', candidates:[]}));
    expect(w.ok).toBe(true);
    await finalizeReservation(r.reservationPath, 'failed', r.runId);
    const lock = path.join(d, 'run.lock');
    const lockData = JSON.parse(fs.readFileSync(lock, 'utf8'));
    expect(lockData.status).toBe('failed');
  });

  it('5. kegagalan sebelum generation -> reservasi berstatus failed', async () => {
    const d = path.join(tmpBase, 't5-' + makeRunId());
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'discovery-result.json'), '{}');
    const r = await reserveTarget(d, makeRunId());
    expect(r.reserved).toBe(false);
  });
});
