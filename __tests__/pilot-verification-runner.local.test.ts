// Komentar penjelas logika: uji lokal runner verifikasi pilot menggunakan mock SDK, tanpa jaringan/API.
import { promises as fs, constants } from 'fs';
import { join } from 'path';
import { runVerification } from '../scripts/pilot-verification-runner';

describe('pilot-verification-runner lokal', () => {
  const tmp = join(__dirname, '..', 'tmp-ver-run');

  beforeEach(async () => {
    try { await fs.rm(tmp, { recursive: true, force: true }); } catch {}
    await fs.mkdir(tmp, { recursive: true });
  });
  afterEach(async () => {
    try { await fs.rm(tmp, { recursive: true, force: true }); } catch {}
  });

  it('sukses: semua checkpoint sampai response_received, satu SDK, http: null', async () => {
    const target = join(tmp, 'v-ok');
    await fs.mkdir(target, { recursive: true });
    const result = await runVerification({
      outputPath: join(target, 'discovery-result.json'),
      model: 'gemini-3.5-flash-lite',
      imagePath: 'fake.png',
      imageSha256: 'abc',
      imageBytes: 100,
      imageDimensions: { width: 3573, height: 2526 },
      legendSource: 'test',
      candidates: [{ tag: 'V-001' }],
      maxOutputTokens: 4096,
      inputUsdPerMillion: 0.30,
      outputUsdPerMillion: 2.50,
      maxBudgetUsd: 0.10,
      timeoutMs: 3000,
      sdk: {
        countTokens: async () => 120,
        generateContent: async () => ({ rawText: '{"confirmed": ["V-001"]}', usage: {} }),
      },
      now: () => '2026-10-12T00:00:00Z',
      writeFile: async (p: string, d: string) => { await fs.writeFile(p, d, 'utf8'); },
    });
    expect(result.status).toBe('completed');
    expect(result.outputWritten).toBe(true);
    expect(result.sdkCallCounts.generateContent).toBe(1);
    expect(result.observedHttpRequests).toBeNull();
    expect(result.providerCompletion).toBe('known');
  });

  it('SDK error: mencapai sdk_call_started lalu gagal, bukan sukses', async () => {
    const target = join(tmp, 'v-err');
    await fs.mkdir(target, { recursive: true });
    const result = await runVerification({
      outputPath: join(target, 'discovery-result.json'),
      model: 'gemini-3.5-flash-lite',
      imagePath: 'fake.png', imageSha256: 'x', imageBytes: 1,
      imageDimensions: { width: 10, height: 10 }, legendSource: 't',
      candidates: [], maxOutputTokens: 100,
      inputUsdPerMillion: 0.30, outputUsdPerMillion: 2.50, maxBudgetUsd: 0.10,
      timeoutMs: 500,
      sdk: {
        countTokens: async () => 10,
        generateContent: async () => { throw new Error('mock SDK error'); },
      },
      now: () => '2026-10-12T00:00:00Z',
      writeFile: async (p: string, d: string) => { await fs.writeFile(p, d, 'utf8'); },
    });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('mock SDK error');
    expect(result.outputWritten).toBe(true);
  });

  it('timeout: gagal dengan providerCompletion unknown, tidak retry', async () => {
    const target = join(tmp, 'v-timeout');
    await fs.mkdir(target, { recursive: true });
    const result = await runVerification({
      outputPath: join(target, 'discovery-result.json'),
      model: 'gemini-3.5-flash-lite',
      imagePath: 'fake.png', imageSha256: 't', imageBytes: 1,
      imageDimensions: { width: 1, height: 1 }, legendSource: 't',
      candidates: [], maxOutputTokens: 50,
      inputUsdPerMillion: 0.30, outputUsdPerMillion: 2.50, maxBudgetUsd: 0.10,
      timeoutMs: 10,
      inputTokens: 10,
      sdk: {
        generateContent: async () => new Promise(r => setTimeout(r, 60000, { rawText: '' })),
      },
      now: () => '2026-10-12T00:00:00Z',
      writeFile: async (p: string, d: string) => { await fs.writeFile(p, d, 'utf8'); },
    });
    expect(result.status).toBe('failed');
    expect(result.providerCompletion).toBe('unknown');
  });

  it('existing target: diblokir sebelum SDK, file tetap sama', async () => {
    const target = join(tmp, 'v-existing');
    await fs.mkdir(target, { recursive: true });
    const file = join(target, 'discovery-result.json');
    await fs.writeFile(file, '{"preserved":true}');
    const result = await runVerification({
      outputPath: file,
      model: 'gemini-3.5-flash-lite',
      imagePath: 'f', imageSha256: 's', imageBytes: 1,
      imageDimensions: { width: 1, height: 1 }, legendSource: 't',
      candidates: [], maxOutputTokens: 10,
      inputUsdPerMillion: 0.30, outputUsdPerMillion: 2.50, maxBudgetUsd: 0.10,
      timeoutMs: 500,
      sdk: { countTokens: async () => 0, generateContent: async () => ({ rawText: '{}' }) },
      now: () => '2026-10-12T00:00:00Z',
      writeFile: async (p: string, d: string) => { await fs.writeFile(p, d, 'utf8'); },
    });
    expect(result.status).toBe('blocked');
    const preserved = await fs.readFile(file, 'utf8');
    expect(preserved).toContain('preserved');
    expect(result.sdkCallCounts.countTokens).toBe(0);
    expect(result.sdkCallCounts.generateContent).toBe(0);
  });
});
