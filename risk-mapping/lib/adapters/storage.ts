/**
 * Storage Adapter
 *
 * Bridge to file storage (local, SharePoint, S3).
 * Implement these to connect Risk Mapping to your storage backend.
 */

// If Asset-Detection is within promia-web-sb project:
// export * from '@/lib/storageAdapter';

// If Asset-Detection is standalone:
// Implement storage methods:

export interface StorageBackendConfig {
    type: 'local' | 'sharepoint' | 's3';
    localPath?: string; // for local storage
    s3Bucket?: string;
    s3Region?: string;
    sharepointSite?: string;
    sharepointDrive?: string;
}

export async function saveFile(
    path: string,
    buffer: Buffer,
    options?: any
): Promise<void> {
    // TODO: Implement file save
    // Handle: local path, S3 path (s3:bucket/key), SharePoint path (sp:site/drive/path)
    throw new Error('saveFile not implemented. Configure your storage adapter.');
}

export async function readFile(path: string): Promise<Buffer> {
    // TODO: Implement file read
    throw new Error('readFile not implemented. Configure your storage adapter.');
}

export async function deleteFile(path: string): Promise<void> {
    // TODO: Implement file delete
    throw new Error('deleteFile not implemented. Configure your storage adapter.');
}

export async function fileExists(path: string): Promise<boolean> {
    // TODO: Implement file exists check
    throw new Error('fileExists not implemented. Configure your storage adapter.');
}

export function getStorageBackend(path: string): 'local' | 's3' | 'sharepoint' {
    if (path.startsWith('s3:')) return 's3';
    if (path.startsWith('sp:')) return 'sharepoint';
    return 'local';
}

export function normalizeStoragePath(path: string): string {
    // Normalize path for storage backend
    return path;
}
