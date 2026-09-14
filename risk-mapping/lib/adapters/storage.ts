import { promises as fs } from 'fs';
import path from 'path';

const storageRoot = process.env.PFD_STORAGE_PATH || './storage/pfd';

export async function saveFile(filePath: string, buffer: Buffer): Promise<void> {
    const fullPath = path.join(storageRoot, filePath);
    const dir = path.dirname(fullPath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, buffer);
}

export async function readFile(filePath: string): Promise<Buffer> {
    const fullPath = path.join(storageRoot, filePath);
    return await fs.readFile(fullPath);
}

export async function deleteFile(filePath: string): Promise<void> {
    const fullPath = path.join(storageRoot, filePath);
    try {
        await fs.unlink(fullPath);
    } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
    }
}

export async function fileExists(filePath: string): Promise<boolean> {
    const fullPath = path.join(storageRoot, filePath);
    try {
        await fs.access(fullPath);
        return true;
    } catch {
        return false;
    }
}

export function getStorageBackend(filePath: string): 'local' | 's3' | 'sharepoint' {
    if (filePath.startsWith('s3:')) return 's3';
    if (filePath.startsWith('sp:')) return 'sharepoint';
    return 'local';
}

export function normalizeStoragePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
