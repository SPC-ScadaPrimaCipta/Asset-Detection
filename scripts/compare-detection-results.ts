/**
 * Compare detection results between old and new methods
 */
import db from '../lib/db';

async function main() {
  // Get recent detection jobs
  const jobsRes = await db.query(`
    SELECT 
      dj.id, dj.document_id, dj.status, dj.legend_ids, dj.created_at,
      d.filename,
      (SELECT COUNT(*) FROM detections WHERE job_id = dj.id) as detection_count,
      (SELECT COUNT(*) FROM detections WHERE job_id = dj.id AND detection_source = 'VISION') as vision_count,
      (SELECT COUNT(*) FROM detections WHERE job_id = dj.id AND detection_source != 'VISION') as text_count,
      (SELECT AVG(confidence) FROM detections WHERE job_id = dj.id) as avg_confidence,
      (SELECT COUNT(*) FROM detections WHERE job_id = dj.id AND asset_tag IS NOT NULL) as with_tag_count
    FROM detection_jobs dj
    JOIN documents d ON dj.document_id = d.id
    ORDER BY dj.created_at DESC
    LIMIT 10
  `);

  console.log('\n📊 Recent Detection Jobs:\n');
  
  for (const job of jobsRes.rows) {
    const visionPct = job.detection_count > 0 
      ? ((job.vision_count / job.detection_count) * 100).toFixed(1) 
      : '0';
    const tagPct = job.detection_count > 0
      ? ((job.with_tag_count / job.detection_count) * 100).toFixed(1)
      : '0';
    
    console.log(`Job: ${job.id.slice(0, 8)}`);
    console.log(`  File: ${job.filename}`);
    console.log(`  Status: ${job.status}`);
    console.log(`  Total Detections: ${job.detection_count}`);
    console.log(`  - VISION (YOLO): ${job.vision_count} (${visionPct}%)`);
    console.log(`  - TEXT parsing: ${job.text_count} (${(100 - parseFloat(visionPct)).toFixed(1)}%)`);
    console.log(`  With Tags: ${job.with_tag_count} (${tagPct}%)`);
    console.log(`  Avg Confidence: ${parseFloat(job.avg_confidence || 0).toFixed(3)}`);
    console.log(`  Created: ${new Date(job.created_at).toLocaleString()}`);
    console.log('');
  }

  // Get detailed comparison for latest COMPLETED job
  const latestCompleted = jobsRes.rows.find(j => j.status === 'COMPLETED');
  
  if (latestCompleted) {
    console.log('\n🔍 Detailed Analysis - Latest Completed Job:\n');
    console.log(`Job ID: ${latestCompleted.id}`);
    console.log(`File: ${latestCompleted.filename}\n`);
    
    // Get detection breakdown by source and confidence
    const breakdownRes = await db.query(`
      SELECT 
        detection_source,
        asset_type,
        COUNT(*) as count,
        AVG(confidence) as avg_conf,
        COUNT(CASE WHEN asset_tag IS NOT NULL THEN 1 END) as tagged_count
      FROM detections
      WHERE job_id = $1
      GROUP BY detection_source, asset_type
      ORDER BY detection_source, count DESC
    `, [latestCompleted.id]);
    
    console.log('Breakdown by Source & Type:');
    console.log('─'.repeat(80));
    
    let visionTotal = 0;
    let textTotal = 0;
    
    for (const row of breakdownRes.rows) {
      const source = row.detection_source || 'UNKNOWN';
      const type = row.asset_type || 'Unknown';
      const tagRate = ((row.tagged_count / row.count) * 100).toFixed(0);
      
      console.log(`${source.padEnd(12)} | ${type.padEnd(25)} | Count: ${String(row.count).padStart(3)} | Conf: ${parseFloat(row.avg_conf).toFixed(3)} | Tagged: ${tagRate}%`);
      
      if (source === 'VISION') visionTotal += parseInt(row.count);
      else textTotal += parseInt(row.count);
    }
    
    console.log('─'.repeat(80));
    console.log(`\nSummary:`);
    console.log(`  VISION (YOLO) detections: ${visionTotal}`);
    console.log(`  TEXT-based detections: ${textTotal}`);
    console.log(`  YOLO contribution: ${((visionTotal / (visionTotal + textTotal)) * 100).toFixed(1)}%`);
    
    // Sample detections
    console.log('\n\n📝 Sample Detections (5 VISION + 5 TEXT):\n');
    
    const visionSamples = await db.query(`
      SELECT asset_tag, asset_type, confidence, 
             ARRAY_LENGTH(evidence, 1) as evidence_count
      FROM detections
      WHERE job_id = $1 AND detection_source = 'VISION'
      ORDER BY confidence DESC
      LIMIT 5
    `, [latestCompleted.id]);
    
    console.log('VISION (YOLO) Samples:');
    for (const s of visionSamples.rows) {
      console.log(`  ${(s.asset_tag || 'no-tag').padEnd(15)} | ${(s.asset_type || 'Unknown').padEnd(25)} | Conf: ${s.confidence.toFixed(3)} | Evidence: ${s.evidence_count} items`);
    }
    
    const textSamples = await db.query(`
      SELECT asset_tag, asset_type, confidence,
             ARRAY_LENGTH(evidence, 1) as evidence_count
      FROM detections
      WHERE job_id = $1 AND detection_source != 'VISION'
      ORDER BY confidence DESC
      LIMIT 5
    `, [latestCompleted.id]);
    
    console.log('\nTEXT-based Samples:');
    for (const s of textSamples.rows) {
      console.log(`  ${(s.asset_tag || 'no-tag').padEnd(15)} | ${(s.asset_type || 'Unknown').padEnd(25)} | Conf: ${s.confidence.toFixed(3)} | Evidence: ${s.evidence_count} items`);
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
