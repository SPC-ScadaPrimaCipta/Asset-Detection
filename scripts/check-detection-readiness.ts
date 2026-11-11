#!/usr/bin/env node
/**
 * Multi-Source Detection Readiness Checker
 * 
 * Verifies all components are ready for ultimate hybrid detection:
 * - Python CV service endpoints
 * - Storage directories
 * - Database schema
 * - YOLO model
 * - Dependencies
 */

import { exec } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';

const execAsync = promisify(exec);

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  fix?: string;
}

const results: CheckResult[] = [];

function log(status: 'pass' | 'fail' | 'warn', name: string, message: string, fix?: string) {
  const color = status === 'pass' ? GREEN : status === 'fail' ? RED : YELLOW;
  const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️';
  
  console.log(`${color}${icon} ${name}${RESET}`);
  console.log(`   ${message}`);
  if (fix) {
    console.log(`   ${BLUE}Fix: ${fix}${RESET}`);
  }
  console.log();
  
  results.push({ name, status, message, fix });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CHECK 1: Storage Directories
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function checkStorageDirectories() {
  const requiredDirs = [
    'storage/dataset/approved',
    'storage/dataset/training',
    'storage/legends/symbols',
    'storage/pages',
  ];
  
  let allExist = true;
  const missing: string[] = [];
  
  for (const dir of requiredDirs) {
    try {
      await access(dir);
    } catch {
      allExist = false;
      missing.push(dir);
    }
  }
  
  if (allExist) {
    log('pass', 'Storage Directories', 'All required directories exist');
  } else {
    log(
      'fail',
      'Storage Directories',
      `Missing: ${missing.join(', ')}`,
      'Run: mkdir -p ' + missing.join(' ')
    );
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CHECK 2: Python CV Service
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function checkPythonService() {
  const CV_SERVICE_URL = process.env.CV_SERVICE_URL || 'http://localhost:8765';
  
  try {
    const response = await fetch(`${CV_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    const engines = data.engines || {};
    const allReady = engines.yolo && engines.ocr_tesseract && engines.opencv;
    
    if (allReady) {
      log(
        'pass',
        'Python CV Service',
        `Running at ${CV_SERVICE_URL}\n   YOLO: ${engines.yolo ? 'OK' : 'FAIL'} | OCR: ${engines.ocr_tesseract ? 'OK' : 'FAIL'} | OpenCV: ${engines.opencv ? 'OK' : 'FAIL'}`
      );
    } else {
      log(
        'warn',
        'Python CV Service',
        `Service running but some engines unavailable:\n   YOLO: ${engines.yolo ? 'OK' : 'FAIL'} | OCR: ${engines.ocr_tesseract ? 'OK' : 'FAIL'} | OpenCV: ${engines.opencv ? 'OK' : 'FAIL'}`,
        'Check services/cv/app.py logs'
      );
    }
  } catch (error: any) {
    log(
      'fail',
      'Python CV Service',
      `Cannot reach ${CV_SERVICE_URL}: ${error.message}`,
      'Start service: npm run cv (in new terminal)'
    );
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CHECK 3: Python Dependencies
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function checkPythonDeps() {
  try {
    const { stdout } = await execAsync('python -m pip list --format=json', {
      cwd: 'services/cv',
    });
    
    const packages = JSON.parse(stdout);
    const packageNames = packages.map((p: any) => p.name.toLowerCase());
    
    const required = ['fastapi', 'opencv-python', 'onnxruntime', 'pytesseract', 'torch', 'clip'];
    const missing = required.filter(pkg => !packageNames.includes(pkg) && !packageNames.includes(pkg + '-headless'));
    
    if (missing.length === 0) {
      log('pass', 'Python Dependencies', 'All required packages installed');
    } else {
      log(
        'fail',
        'Python Dependencies',
        `Missing: ${missing.join(', ')}`,
        'Run: cd services/cv && pip install -r requirements.txt'
      );
    }
  } catch (error: any) {
    log(
      'warn',
      'Python Dependencies',
      `Cannot check (Python not in PATH or services/cv not accessible)`,
      'Manually verify: cd services/cv && pip list'
    );
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CHECK 4: YOLO Model
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function checkYOLOModel() {
  const modelPaths = [
    'services/cv/models/yolo-pid.onnx',
    'model/yolo-pid-v8n-203.onnx',
  ];
  
  let found = false;
  let foundPath = '';
  
  for (const modelPath of modelPaths) {
    try {
      await access(modelPath);
      found = true;
      foundPath = modelPath;
      break;
    } catch {
      continue;
    }
  }
  
  if (found) {
    log('pass', 'YOLO Model', `Found at ${foundPath}`);
  } else {
    log(
      'fail',
      'YOLO Model',
      `Not found in: ${modelPaths.join(' OR ')}`,
      'Place trained YOLO model at services/cv/models/yolo-pid.onnx'
    );
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CHECK 5: Database Schema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function checkDatabaseSchema() {
  try {
    const db = (await import('../lib/db.js')).default;
    
    // Check pgvector extension
    const pgvectorCheck = await db.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) as has_pgvector
    `);
    
    if (!pgvectorCheck.rows[0].has_pgvector) {
      log(
        'fail',
        'Database Schema',
        'pgvector extension not installed',
        'Run: CREATE EXTENSION vector; in PostgreSQL'
      );
      return;
    }
    
    // Check required tables
    const tablesCheck = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('symbol_embeddings', 'detections', 'training_exports')
    `);
    
    const existingTables = tablesCheck.rows.map(r => r.table_name);
    const requiredTables = ['symbol_embeddings', 'detections', 'training_exports'];
    const missingTables = requiredTables.filter(t => !existingTables.includes(t));
    
    if (missingTables.length === 0) {
      log('pass', 'Database Schema', 'All required tables exist with pgvector');
    } else {
      log(
        'fail',
        'Database Schema',
        `Missing tables: ${missingTables.join(', ')}`,
        'Run: npm run migrate'
      );
    }
  } catch (error: any) {
    log(
      'fail',
      'Database Schema',
      `Cannot connect to database: ${error.message}`,
      'Check DATABASE_URL in .env.local'
    );
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CHECK 6: Environment Variables
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function checkEnvVars() {
  const multiSourceEnabled = process.env.ENABLE_MULTI_SOURCE === 'true';
  const cvServiceUrl = process.env.CV_SERVICE_URL;
  
  if (multiSourceEnabled) {
    log(
      'pass',
      'Environment Variables',
      `ENABLE_MULTI_SOURCE=true\n   CV_SERVICE_URL=${cvServiceUrl || 'http://localhost:8765 (default)'}`
    );
  } else {
    log(
      'warn',
      'Environment Variables',
      'ENABLE_MULTI_SOURCE not set to true (using old pipeline)',
      'Add to .env.local: ENABLE_MULTI_SOURCE=true'
    );
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CHECK 7: Approved Crops (Learning Status)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function checkApprovedCrops() {
  try {
    const files = await readdir('storage/dataset/approved');
    const pngFiles = files.filter(f => f.endsWith('.png'));
    
    if (pngFiles.length === 0) {
      log(
        'warn',
        'Approved Crops',
        'No approved detection crops yet (OpenCV template matching disabled)',
        'Approve detections via UI to start learning'
      );
    } else if (pngFiles.length < 10) {
      log(
        'warn',
        'Approved Crops',
        `Only ${pngFiles.length} approved crops (recommend 50+ for good accuracy)`,
        'Continue approving detections to improve matching'
      );
    } else {
      log(
        'pass',
        'Approved Crops',
        `${pngFiles.length} approved crops available for template matching`
      );
    }
  } catch {
    log('warn', 'Approved Crops', 'Cannot read storage/dataset/approved/');
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function main() {
  console.log('\n' + BLUE + '═'.repeat(60) + RESET);
  console.log(BLUE + '  Ultimate Hybrid Detection - Readiness Check' + RESET);
  console.log(BLUE + '═'.repeat(60) + RESET + '\n');
  
  await checkEnvVars();
  await checkStorageDirectories();
  await checkDatabaseSchema();
  await checkYOLOModel();
  await checkPythonService();
  await checkPythonDeps();
  await checkApprovedCrops();
  
  // Summary
  console.log(BLUE + '═'.repeat(60) + RESET);
  console.log(BLUE + '  Summary' + RESET);
  console.log(BLUE + '═'.repeat(60) + RESET + '\n');
  
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const warned = results.filter(r => r.status === 'warn').length;
  
  console.log(`${GREEN}✅ Passed: ${passed}${RESET}`);
  console.log(`${RED}❌ Failed: ${failed}${RESET}`);
  console.log(`${YELLOW}⚠️  Warnings: ${warned}${RESET}\n`);
  
  if (failed === 0 && warned === 0) {
    console.log(GREEN + '🎉 All systems ready! You can run detection now.' + RESET);
    console.log('\nTo start detection:');
    console.log('  1. npm run dev (Terminal 1)');
    console.log('  2. npm run worker (Terminal 2)');
    console.log('  3. npm run cv (Terminal 3)');
  } else if (failed === 0) {
    console.log(YELLOW + '⚡ System functional but has warnings (check above)' + RESET);
  } else {
    console.log(RED + '❌ System not ready. Fix failed checks above.' + RESET);
    process.exit(1);
  }
}

main().catch(console.error);
