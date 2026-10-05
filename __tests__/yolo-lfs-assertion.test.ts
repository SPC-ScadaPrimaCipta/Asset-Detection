import * as fs from 'fs';
import * as path from 'path';
import { assertYoloModelArtifact } from '@/lib/detection/yolo/yolo-inference';

describe('assertYoloModelArtifact — Git LFS hydration guard', () => {
  const TMP_DIR = path.resolve(__dirname, '../storage/test-lfs-tmp');

  beforeAll(() => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('throws a helpful error when the model is a Git LFS pointer text file', async () => {
    const pointerFile = path.join(TMP_DIR, 'pointer.onnx');
    fs.writeFileSync(
      pointerFile,
      'version https://git-lfs.github.com/spec/v1\noid sha256:29340a1159\nsize 103700300\n',
    );

    await expect(assertYoloModelArtifact(pointerFile)).rejects.toThrow(
      /Git LFS pointer, not a hydrated ONNX artifact.*Run `git lfs pull`/,
    );
  });

  it('throws when the model file is unexpectedly small (<1MB) and not a pointer', async () => {
    const smallFile = path.join(TMP_DIR, 'small.onnx');
    fs.writeFileSync(smallFile, 'not-a-pointer-but-too-small');

    await expect(assertYoloModelArtifact(smallFile)).rejects.toThrow(
      /unexpectedly small.*Expected ~99MB/,
    );
  });

  it('throws when the model file does not exist', async () => {
    await expect(
      assertYoloModelArtifact(path.join(TMP_DIR, 'nonexistent.onnx')),
    ).rejects.toThrow(/not found/);
  });

  it('passes when the model is a real binary artifact (>1MB)', async () => {
    const realModelPath = path.resolve(process.cwd(), 'model/yolo-pid.onnx');
    if (fs.existsSync(realModelPath)) {
      await expect(assertYoloModelArtifact(realModelPath)).resolves.not.toThrow();
    }
  });
});
