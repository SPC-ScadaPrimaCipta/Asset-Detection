import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { env } from "@/lib/env";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { legend_id?: unknown; legend_ids?: unknown } = {};
  try { body = await request.json(); } catch { body = {}; }
  const { resolveJobLegendIds, effectiveJobLegendIds } = await import('@/lib/job-legends');
  const job = await db.query("SELECT * FROM detection_jobs WHERE id=$1", [id]);
  if (job.rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // No legend fields in the body = keep the job's existing selection.
  const hasLegendInput = body.legend_ids !== undefined || body.legend_id !== undefined;
  const resolved = hasLegendInput
    ? await resolveJobLegendIds(body)
    : { legendIds: effectiveJobLegendIds(job.rows[0]), primaryLegendId: job.rows[0].legend_id ?? null };
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }
  const { legendIds, primaryLegendId } = resolved;
  await db.query("UPDATE detection_jobs SET legend_id=$1, legend_ids=$2 WHERE id=$3", [
    primaryLegendId,
    legendIds.length > 0 ? legendIds : null,
    id,
  ]);
  try {
    const { Queue } = await import('bullmq');
    const IORedis = (await import('ioredis')).default;
    const conn = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableOfflineQueue: false, lazyConnect: true });
    await conn.connect().catch(() => {});
    const q = new Queue('detection', { connection: conn });
    await q.add('detection', { jobId: id, legendId: primaryLegendId, legendIds }, { jobId: id, removeOnComplete: true, removeOnFail: 100 });
    conn.disconnect();
  } catch {
    await db.query("UPDATE detection_jobs SET status='PENDING' WHERE id=$1", [id]);
  }
  return NextResponse.json({ id, status: "QUEUED" });
}
