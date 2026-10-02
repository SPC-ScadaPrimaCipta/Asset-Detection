import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getAiConfig } from "@/lib/ai-config";

export async function GET() {
  const checks: Record<string, string> = {};
  try { await db.query("SELECT 1"); checks.database = "ok"; } catch { checks.database = "fail"; }

  let aiConfigured = "no";
  try {
    const cfg = await getAiConfig();
    const hasKey = cfg.provider === 'deepseek' ? !!cfg.deepseekKey : !!cfg.geminiKey;
    checks.ai_provider = cfg.provider;
    checks.gemini_configured = cfg.geminiKey ? "yes" : "no";
    checks.deepseek_configured = cfg.deepseekKey ? "yes" : "no";
    aiConfigured = hasKey ? "yes" : "no";
    checks.ai_configured = aiConfigured;
    if (cfg.provider === 'gemini') checks.gemini_model = cfg.geminiModel;
    if (cfg.provider === 'deepseek') checks.deepseek_model = cfg.deepseekModel;
  } catch {
    checks.ai_provider = "unknown";
    checks.gemini_configured = "no";
    checks.deepseek_configured = "no";
    checks.ai_configured = "no";
  }

  const healthy = checks.database === "ok";
  return NextResponse.json({ status: healthy ? "healthy" : "degraded", checks }, { status: healthy ? 200 : 503 });
}
