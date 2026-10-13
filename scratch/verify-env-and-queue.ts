import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const { default: db } = await import("../lib/db");
  const { env } = await import("../lib/env");
  const { default: IORedis } = await import("ioredis");
  const { Queue } = await import("bullmq");
  console.log("=== VERIFIKASI ENVIRONMENT & ANTRIAN LOKAL ===");

  // 1. Database check
  try {
    const dbRes = await db.query("SELECT current_database(), inet_server_addr(), inet_server_port(), NOW()");
    const row = dbRes.rows[0];
    console.log("[DB LOKAL] OK:", {
      database: row.current_database,
      serverAddr: row.inet_server_addr ?? "localhost",
      serverPort: row.inet_server_port ?? 5432,
      time: row.now,
    });
  } catch (err: any) {
    console.error("[DB LOKAL] GAGAL:", err.message);
    process.exit(1);
  }

  // 2. Redis & Queue check
  const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  try {
    const pong = await redis.ping();
    console.log("[REDIS LOKAL] OK: ping ->", pong);

    const queue = new Queue("detection", { connection: redis });
    const waiting = await queue.getWaitingCount();
    const active = await queue.getActiveCount();
    const delayed = await queue.getDelayedCount();
    const failed = await queue.getFailedCount();
    const completed = await queue.getCompletedCount();

    console.log("[QUEUE 'detection'] Status:", {
      waiting,
      active,
      delayed,
      failed,
      completed,
    });

    if (waiting > 0 || active > 0) {
      console.log("Daftar job waiting/active:");
      const waitingJobs = await queue.getWaiting(0, 10);
      for (const j of waitingJobs) {
        console.log(`- Waiting Job ID: ${j.id}, Name: ${j.name}, Data:`, j.data);
      }
      const activeJobs = await queue.getActive(0, 10);
      for (const j of activeJobs) {
        console.log(`- Active Job ID: ${j.id}, Name: ${j.name}, Data:`, j.data);
      }
    } else {
      console.log("[QUEUE] Bersih / tidak ada job tertunda yang aktif.");
    }

    await queue.close();
    await redis.quit();
  } catch (err: any) {
    console.error("[REDIS LOKAL] GAGAL:", err.message);
    process.exit(1);
  }

  process.exit(0);
}

main();
