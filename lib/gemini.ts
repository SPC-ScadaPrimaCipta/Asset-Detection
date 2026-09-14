import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { env } from "./env";

export type AIProvider = "gemini" | "deepseek";

export function getGeminiModel() {
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY!);
  return genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
}

export function getDeepSeekClient() {
  return new OpenAI({
    apiKey: env.DEEPSEEK_API_KEY!,
    baseURL: "https://api.deepseek.com/v1",
  });
}

export const aiProvider = env.AI_PROVIDER as AIProvider;
