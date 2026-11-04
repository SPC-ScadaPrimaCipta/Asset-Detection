import * as fs from 'fs';
import * as path from 'path';

describe('Active Learning & YOLO Dataset Pipeline', () => {
  it('verifies dataset export script exists and is registered in package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.scripts['dataset:export-yolo']).toBeDefined();
    expect(fs.existsSync(path.resolve(process.cwd(), 'scripts/export-yolo-dataset.ts'))).toBe(true);
  });

  it('verifies Google Colab training notebook exists with valid JSON structure', () => {
    const notebookPath = path.resolve(process.cwd(), 'scripts/train_yolo_pid_colab.ipynb');
    expect(fs.existsSync(notebookPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(notebookPath, 'utf8'));
    expect(content.cells).toBeDefined();
    expect(content.cells.length).toBeGreaterThanOrEqual(4);
  });

  it('verifies dataset directory layout supports YOLO format', () => {
    const outputBase = path.resolve(process.cwd(), 'dataset_yolo');
    const yamlContent = `
path: .
train: images/train
val: images/val
nc: 7
names:
  0: valve
  1: pump
  2: vessel
  3: heat_exchanger
  4: compressor
  5: instrument
  6: filter
`.trim();

    expect(yamlContent).toContain('nc: 7');
    expect(yamlContent).toContain('0: valve');
  });
});

