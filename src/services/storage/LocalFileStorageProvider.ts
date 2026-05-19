import path from 'path';
import { promises as fs } from 'fs';

import { AppError } from '../../errors/AppError';
import { FileStorageProvider } from './FileStorageProvider';
import { SaveFileRequest, StoredFileReference } from './types';

const sanitizeSegment = (value: string, fieldName: string): string => {
    const trimmed = value.trim();

    if (!trimmed) {
        throw new AppError(`${fieldName} is required for local storage.`, 400);
    }

    if (trimmed.includes('..') || path.isAbsolute(trimmed)) {
        throw new AppError(`${fieldName} must be a relative safe path segment.`, 400);
    }

    return trimmed.replace(/\\/g, '/');
};

export class LocalFileStorageProvider implements FileStorageProvider {
    readonly kind = 'local' as const;

    private readonly basePath: string;

    constructor(basePath?: string) {
        const configuredBasePath = String(basePath || process.env.STORAGE_LOCAL_BASE_PATH || 'storage').trim();
        this.basePath = path.resolve(process.cwd(), configuredBasePath);
    }

    async save(request: SaveFileRequest): Promise<StoredFileReference> {
        const folder = sanitizeSegment(request.folder, 'folder');
        const fileName = sanitizeSegment(request.fileName, 'fileName');

        const relativeKey = path.posix.join(folder, fileName);
        const absolutePath = path.join(this.basePath, ...relativeKey.split('/'));
        const absoluteParent = path.dirname(absolutePath);

        await fs.mkdir(absoluteParent, { recursive: true });
        await fs.writeFile(absolutePath, request.content);

        return {
            provider: this.kind,
            key: relativeKey,
            size: request.content.length,
            contentType: request.contentType,
            absolutePath,
        };
    }

    async read(key: string): Promise<Buffer> {
        const sanitizedKey = sanitizeSegment(key, 'key');
        const absolutePath = path.join(this.basePath, ...sanitizedKey.split('/'));

        return fs.readFile(absolutePath);
    }

    async delete(key: string): Promise<void> {
        const sanitizedKey = sanitizeSegment(key, 'key');
        const absolutePath = path.join(this.basePath, ...sanitizedKey.split('/'));

        await fs.rm(absolutePath, { force: true });
    }
}
