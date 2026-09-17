import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import OpenAI from "openai";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { getAiConfig } from "./ai-config";

export type AIProvider = "gemini" | "deepseek";

// --- Resolved (Settings DB wins, env fallback) — use these in all runtime paths ---

export async function getGeminiClient() {
  const { geminiKey } = await getAiConfig();
  if (!geminiKey) throw new Error("GEMINI_API_KEY not configured — set in Settings or .env.local");
  return new GoogleGenerativeAI(geminiKey);
}

export async function getGeminiFileManager() {
  const { geminiKey } = await getAiConfig();
  if (!geminiKey) throw new Error("GEMINI_API_KEY not configured — set in Settings or .env.local");
  return new GoogleAIFileManager(geminiKey);
}

export async function getGeminiModel() {
  const { geminiKey, geminiModel } = await getAiConfig();
  if (!geminiKey) throw new Error("GEMINI_API_KEY not configured — set in Settings or .env.local");
  return new GoogleGenerativeAI(geminiKey).getGenerativeModel({ model: geminiModel });
}

export async function getDeepSeekClient() {
  const { deepseekKey } = await getAiConfig();
  if (!deepseekKey) throw new Error("DEEPSEEK_API_KEY not configured — set in Settings or .env.local");
  return new OpenAI({ apiKey: deepseekKey, baseURL: "https://api.deepseek.com/v1" });
}

// --- Explicit-key variants (for scan/validate flows that haven't saved yet) ---

export function makeGeminiClient(apiKey: string) {
  if (!apiKey) throw new Error("apiKey required");
  return new GoogleGenerativeAI(apiKey);
}
export function makeGeminiFileManager(apiKey: string) {
  if (!apiKey) throw new Error("apiKey required");
  return new GoogleAIFileManager(apiKey);
}
export function makeDeepSeekClient(apiKey: string) {
  if (!apiKey) throw new Error("apiKey required");
  return new OpenAI({ apiKey, baseURL: "https://api.deepseek.com/v1" });
}

/**
 * Upload PDF buffer to Gemini Files API.
 * Resolves API key from Settings DB (not hardcoded env).
 */
export async function uploadPdfToGemini(buf: Buffer, displayName: string): Promise<{ fileUri: string; mimeType: string }> {
  const fm = await getGeminiFileManager();
  const tmpPath = path.join(tmpdir(), `gemini-upload-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  await writeFile(tmpPath, buf);
  try {
    const res = await fm.uploadFile(tmpPath, { mimeType: "application/pdf", displayName });
    return { fileUri: res.file.uri, mimeType: res.file.mimeType };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

export async function deleteGeminiFile(fileUri: string): Promise<void> {
  try {
    const fm = await getGeminiFileManager();
    const name = fileUri.split("/files/")[1];
    if (name) await fm.deleteFile(name);
  } catch {}
}
