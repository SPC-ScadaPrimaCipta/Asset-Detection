import { NextResponse } from "next/server";
import db from "@/lib/db";
import { env } from "@/lib/env";

export async function GET() {
  const checks: Record<string, string> = {};

  // DB
  try {
    await db.query("SELECT 1");
    checks.database = "ok";
  } catch {
    checks.database = "fail";
  }

  // Redis (optional)
  try {
    const { default: IORedis } = await import("ioredis");
    const redis = new IORedis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();
    await redis.ping();
    redis.disconnect();
    checks.redis = "ok";
  } catch {
    checks.redis = "unavailable";
  }

  // AI providers
  checks.ai_provider = env.AI_PROVIDER;
  checks.gemini_configured = env.GEMINI_API_KEY ? "yes" : "no";
  checks.deepseek_configured = env.DEEPSEEK_API_KEY ? "yes" : "no";

  const healthy = checks.database === "ok";
  return NextResponse.json({ status: healthy ? "healthy" : "degraded", checks }, { status: healthy ? 200 : 503 });
}
