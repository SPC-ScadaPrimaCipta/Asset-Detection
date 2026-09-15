import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import OpenAI from "openai";
import { env } from "./env";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

export type AIProvider = "gemini" | "deepseek";

export function getGeminiModel() {
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY!);
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  return genAI.getGenerativeModel({ model });
}

export function getGeminiClient() {
  return new GoogleGenerativeAI(env.GEMINI_API_KEY!);
}

export function getGeminiFileManager() {
  return new GoogleAIFileManager(env.GEMINI_API_KEY!);
}

/**
 * Upload PDF buffer to Gemini Files API.
 * Returns fileUri + mimeType for use in subsequent generateContent calls.
 * File persists ~48h — caller should delete after job if desired.
 */
export async function uploadPdfToGemini(
  buf: Buffer,
  displayName: string
): Promise<{ fileUri: string; mimeType: string }> {
  const fm = getGeminiFileManager();
  // Write to temp file — GoogleAIFileManager requires file path
  const tmpPath = path.join(tmpdir(), `gemini-upload-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  await writeFile(tmpPath, buf);
  try {
    const res = await fm.uploadFile(tmpPath, {
      mimeType: "application/pdf",
      displayName,
    });
    return { fileUri: res.file.uri, mimeType: res.file.mimeType };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

/**
 * Delete a Gemini uploaded file by URI (cleanup after job).
 * Non-fatal — swallow errors.
 */
export async function deleteGeminiFile(fileUri: string): Promise<void> {
  try {
    const fm = getGeminiFileManager();
    // Extract file name from URI: files/{name}
    const name = fileUri.split("/files/")[1];
    if (name) await fm.deleteFile(name);
  } catch {
    // Non-fatal cleanup
  }
}

export function getDeepSeekClient() {
  return new OpenAI({
    apiKey: env.DEEPSEEK_API_KEY!,
    baseURL: "https://api.deepseek.com/v1",
  });
}

export const aiProvider = env.AI_PROVIDER as AIProvider;
