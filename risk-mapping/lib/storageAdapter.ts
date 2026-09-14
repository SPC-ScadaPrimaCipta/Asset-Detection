import path from 'path';
import { saveFile, readFile, deleteFile, fileExists } from './adapters/storage';

export interface PutFileOptions {
    category: string;
    identifier: string | number;
    subPath?: string | number;
    fileName: string;
    buffer: Buffer;
    mimeType?: string;
    localRootOverride?: string;
}

export async function putFile(opts: PutFileOptions): Promise<{ relPath: string; backend: 'local' }> {
    const parts = [opts.category, String(opts.identifier)];
    if (opts.subPath !== undefined && opts.subPath !== null) {
        parts.push(String(opts.subPath));
    }
    parts.push(opts.fileName);

    const relPath = parts.join('/');
    await saveFile(relPath, opts.buffer);

    return { relPath, backend: 'local' };
}

export async function getFile(relPath: string, root: string): Promise<Buffer> {
    return await readFile(relPath);
}

export function parseStoragePath(relPath: string): { backend: 'local' | 's3' | 'sharepoint'; keyOrPath: string } {
    if (relPath.startsWith('s3:')) {
        return { backend: 's3', keyOrPath: relPath.substring(3) };
    }
    if (relPath.startsWith('sp:')) {
        return { backend: 'sharepoint', keyOrPath: relPath.substring(3) };
    }
    return { backend: 'local', keyOrPath: relPath };
}

export function getConfiguredBackend(): 'local' | 's3' | 'sharepoint' {
    return 'local'; // ponytail: add config when needed
}

export async function getPresignedDownloadUrl(relPath: string): Promise<string> {
    // Local storage doesn't need presigned URLs; return file path
    return `/api/risk-mapping/pfd-file?path=${encodeURIComponent(relPath)}`;
}
