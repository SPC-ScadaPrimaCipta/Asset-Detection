import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface YoloDetection {
  class: string;
  bbox: [number, number, number, number]; // [x, y, w, h]
  confidence: number;
}

const PYTHON_BIN = process.env.YOLO_PYTHON_BIN || 
  path.join(process.cwd(), 'workers', 'yolo', 'venv', 'Scripts', 'python.exe');

const YOLO_SCRIPT = path.join(process.cwd(), 'workers', 'yolo', 'yolo_worker.py');

/**
 * Run YOLO detection on an image.
 * 
 * @param imagePath Absolute path to image file
 * @param modelPath Optional custom model path
 * @param confidence Confidence threshold (default 0.25)
 * @returns Array of detections
 */
export async function runYoloDetection(
  imagePath: string,
  modelPath?: string,
  confidence: number = 0.25
): Promise<YoloDetection[]> {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image not found: ${imagePath}`);
  }

  const args = [YOLO_SCRIPT, imagePath, '--conf', confidence.toString()];
  if (modelPath) {
    args.push('--model', modelPath);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, args);
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`YOLO worker failed (exit ${code}): ${stderr}`));
        return;
      }
      
      try {
        const detections = JSON.parse(stdout) as YoloDetection[];
        resolve(detections);
      } catch (err) {
        reject(new Error(`Failed to parse YOLO output: ${err}\nOutput: ${stdout}`));
      }
    });
    
    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn YOLO worker: ${err.message}`));
    });
  });
}

/**
 * Check if YOLO worker is available and functional.
 */
export async function checkYoloWorker(): Promise<{ available: boolean; error?: string }> {
  if (!fs.existsSync(PYTHON_BIN)) {
    return {
      available: false,
      error: `Python not found at ${PYTHON_BIN}. Run: scripts/setup-yolo-worker.bat`
    };
  }
  
  if (!fs.existsSync(YOLO_SCRIPT)) {
    return {
      available: false,
      error: `YOLO script not found at ${YOLO_SCRIPT}`
    };
  }
  
  // TODO: Test actual inference with dummy image
  return { available: true };
}
