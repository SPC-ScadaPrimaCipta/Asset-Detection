// Komentar penjelas logika: runner verification pilot yang dapat diuji tanpa jaringan.
import { promises as fs } from 'fs';
import { dirname } from 'path';
import { makeRunId, writeExclusive } from './pilot-output-guard';

export type VerificationCheckpoint =
  | 'reserved'
  | 'input_ready'
  | 'budget_checked'
  | 'sdk_call_started'
  | 'response_received'
  | 'failed';

export type VerificationStatus = 'completed' | 'failed' | 'blocked';

export interface VerificationSdkResponse {
  rawText: string;
  usage?: unknown;
  finishReason?: string | null;
}

export interface VerificationSdk {
  countTokens?: () => Promise<number>;
  generateContent: () => Promise<VerificationSdkResponse>;
}

type PilotWriteFile = (filePath: string, data: string) => Promise<void>;

export interface VerificationRunOptions {
  outputPath: string;
  checkpointPath?: string;
  lockPath?: string;
  runId?: string;
  model: string;
  imagePath: string;
  imageSha256: string;
  imageBytes: number;
  imageDimensions: { width: number; height: number };
  legendSource: string;
  candidates: unknown[];
  maxOutputTokens: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  maxBudgetUsd: number;
  inputTokens?: number;
  timeoutMs: number;
  sdk: VerificationSdk;
  now?: () => string;
  writeFile?: PilotWriteFile;
}

export interface VerificationRunResult {
  status: VerificationStatus;
  runId: string;
  outputPath: string;
  checkpointPath: string;
  lockPath: string;
  lastCheckpoint?: VerificationCheckpoint;
  sdkCallCounts: { countTokens: number; generateContent: number };
  observedHttpRequests: number | null;
  error?: string;
  providerCompletion?: 'known' | 'unknown';
  outputWritten: boolean;
}

interface CheckpointRecord {
  schemaVersion: 'pilot-verification-checkpoint-v1';
  runId: string;
  status: VerificationCheckpoint;
  history: VerificationCheckpoint[];
  sdkCallCounts: { countTokens: number; generateContent: number };
  observedHttpRequests: number | null;
  providerCompletion?: 'known' | 'unknown';
  error?: string;
  updatedAt: string;
}

const defaultNow = () => new Date().toISOString();

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseResponse(rawText: string): unknown | null {
  try {
    return JSON.parse(rawText);
  } catch {
    const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (!fenced) return null;
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      return null;
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`Verification SDK timeout after ${timeoutMs}ms`);
      error.name = 'VerificationTimeoutError';
      reject(error);
    }, timeoutMs);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function runVerification(options: VerificationRunOptions): Promise<VerificationRunResult> {
  const now = options.now ?? defaultNow;
  const writeFile = (options.writeFile ?? (async (p, d) => { await fs.writeFile(p, d, 'utf8'); })) as PilotWriteFile;
  const runId = options.runId ?? makeRunId();
  const checkpointPath = options.checkpointPath ?? `${options.outputPath}.checkpoint.json`;
  const lockPath = options.lockPath ?? `${options.outputPath}.lock`;
  const sdkCallCounts = { countTokens: 0, generateContent: 0 };
  const resultBase = {
    schemaVersion: 'pilot-verification-api-v3',
    runId,
    model: options.model,
    pageId: 'sheet-1-p1',
    input: {
      imagePath: options.imagePath,
      imageSha256: options.imageSha256,
      imageBytes: options.imageBytes,
      dimensions: options.imageDimensions,
      legendSource: options.legendSource,
      baselineIncluded: false,
      candidateCount: options.candidates.length,
    },
    request: {
      sdkCallCounts,
      observedHttpRequests: null,
      retry: false,
      fallback: false,
      maxOutputTokens: options.maxOutputTokens,
    },
    notGroundTruth: true,
  };

  const blocked = (reason: string): VerificationRunResult => ({
    status: 'blocked', runId, outputPath: options.outputPath, checkpointPath, lockPath,
    sdkCallCounts, observedHttpRequests: null, error: reason, outputWritten: false,
  });

  // Preflight target and reservation checks happen before countTokens or generateContent.
  if (await exists(options.outputPath)) return blocked('Target output already exists; stopped before SDK');
  if (await exists(checkpointPath)) return blocked('Checkpoint output already exists; stopped before SDK');
  if (await exists(lockPath)) return blocked('Verification reservation already exists; stopped before SDK');
  await fs.mkdir(dirname(options.outputPath), { recursive: true });
  try {
    const lock = await fs.open(lockPath, 'wx');
    try {
      await lock.writeFile(JSON.stringify({ runId, status: 'reserved', isArtifact: false, createdAt: now() }) + '\n');
    } finally {
      await lock.close();
    }
  } catch (error) {
    return blocked(`Exclusive reservation failed: ${errorText(error)}`);
  }

  const history: VerificationCheckpoint[] = [];
  let lastCheckpoint: VerificationCheckpoint | undefined;
  let providerCompletion: 'known' | 'unknown' | undefined;
  let checkpointWriteError: string | undefined;

  const writeCheckpoint = async (status: VerificationCheckpoint, extra: Partial<CheckpointRecord> = {}) => {
    history.push(status);
    lastCheckpoint = status;
    const record: CheckpointRecord = {
      schemaVersion: 'pilot-verification-checkpoint-v1', runId, status, history: [...history],
      sdkCallCounts: { ...sdkCallCounts }, observedHttpRequests: null, updatedAt: now(), ...extra,
    };
    try {
      await writeFile(checkpointPath, JSON.stringify(record, null, 2));
    } catch (error) {
      checkpointWriteError = errorText(error);
      throw error;
    }
  };

  const finishLock = async (status: 'succeeded' | 'failed') => {
    await writeFile(lockPath, JSON.stringify({ runId, status, isArtifact: false, completedAt: now() }) + '\n');
  };

  const fail = async (error: unknown, providerState: 'known' | 'unknown' = 'known'): Promise<VerificationRunResult> => {
    const message = errorText(error);
    providerCompletion = providerState;
    try {
      await writeCheckpoint('failed', { error: message, providerCompletion: providerState });
    } catch (checkpointError) {
      checkpointWriteError = errorText(checkpointError);
    }
    try { await finishLock('failed'); } catch { /* lock state is best effort after failure */ }
    const output = { ...resultBase, status: 'failed', checkpoints: history, lastCheckpoint, error: message,
      providerCompletion: providerState, rawResponse: '', parsedResponse: null, candidates: null,
      timing: { completedAt: now() }, checkpointWriteError: checkpointWriteError ?? null };
    let outputWritten = false;
    try { outputWritten = (await writeExclusive(options.outputPath, JSON.stringify(output, null, 2))).ok; } catch { outputWritten = false; }
    return { status: 'failed', runId, outputPath: options.outputPath, checkpointPath, lockPath, lastCheckpoint,
      sdkCallCounts, observedHttpRequests: null, error: message, providerCompletion: providerState, outputWritten };
  };

  try {
    await writeCheckpoint('reserved');
    await writeFile(lockPath, JSON.stringify({ runId, status: 'running', isArtifact: false, updatedAt: now() }) + '\n');
    await writeCheckpoint('input_ready');

    let inputTokens = options.inputTokens;
    if (inputTokens === undefined) {
      if (!options.sdk.countTokens) return await fail(new Error('countTokens implementation is required when inputTokens is absent'));
      sdkCallCounts.countTokens += 1;
      inputTokens = await options.sdk.countTokens();
    }
    const estimatedInputUsd = inputTokens * options.inputUsdPerMillion / 1_000_000;
    const estimatedOutputUsd = options.maxOutputTokens * options.outputUsdPerMillion / 1_000_000;
    const estimatedUpperBoundUsd = estimatedInputUsd + estimatedOutputUsd;
    if (!Number.isFinite(inputTokens) || estimatedUpperBoundUsd > options.maxBudgetUsd) {
      return await fail(new Error(`Budget check failed: estimated upper bound $${estimatedUpperBoundUsd.toFixed(6)}`));
    }
    await writeCheckpoint('budget_checked');

    sdkCallCounts.generateContent += 1;
    await writeCheckpoint('sdk_call_started');
    const generationStartedAt = Date.now();
    let response: VerificationSdkResponse;
    try {
      response = await withTimeout(options.sdk.generateContent(), options.timeoutMs);
    } catch (error) {
      const timeout = error instanceof Error && error.name === 'VerificationTimeoutError';
      return await fail(error, timeout ? 'unknown' : 'known');
    }
    const generationDurationMs = Date.now() - generationStartedAt;
    await writeCheckpoint('response_received', { providerCompletion: 'known' });
    const output = {
      ...resultBase, status: 'completed', checkpoints: history, lastCheckpoint,
      cost: { inputTokens, estimatedInputUsd, estimatedOutputUsd, estimatedUpperBoundUsd, maxBudgetUsd: options.maxBudgetUsd,
        inputUsdPerMillion: options.inputUsdPerMillion, outputUsdPerMillion: options.outputUsdPerMillion, actualCostUsd: null },
      timing: { generationDurationMs, completedAt: now() }, usage: response.usage ?? null,
      finishReason: response.finishReason ?? null, rawResponse: response.rawText, parsedResponse: parseResponse(response.rawText),
      originalCandidates: options.candidates, verificationCandidates: parseResponse(response.rawText),
    };
    const writeResult = await writeExclusive(options.outputPath, JSON.stringify(output, null, 2));
    if (!writeResult.ok) return await fail(new Error(writeResult.message ?? 'Exclusive verification output write failed'));
    await finishLock('succeeded');
    return { status: 'completed', runId, outputPath: options.outputPath, checkpointPath, lockPath, lastCheckpoint,
      sdkCallCounts, observedHttpRequests: null, providerCompletion: 'known', outputWritten: true };
  } catch (error) {
    return await fail(error);
  }
}
