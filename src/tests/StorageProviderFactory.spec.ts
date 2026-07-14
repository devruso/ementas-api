import path from 'path';
import { promises as fs } from 'fs';

import { createStorageProvider } from '../services/storage/createStorageProvider';
import { AppError } from '../errors/AppError';

describe('Storage provider factory', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterEach(async () => {
        process.env = { ...originalEnv };
        const tmpRoot = path.resolve(process.cwd(), 'tmp/storage-provider-test');
        await fs.rm(tmpRoot, { recursive: true, force: true });
    });

    it('should use local provider by default and persist file on disk', async () => {
        process.env.STORAGE_PROVIDER = 'local';
        process.env.STORAGE_LOCAL_BASE_PATH = 'tmp/storage-provider-test';

        const provider = createStorageProvider();
        const saved = await provider.save({
            folder: 'signatures',
            fileName: 'sample.bin',
            content: Buffer.from('ok-local-provider', 'utf-8'),
            contentType: 'application/octet-stream',
        });

        expect(provider.kind).toBe('local');
        expect(saved.key).toBe('signatures/sample.bin');
        expect(saved.absolutePath).toBeDefined();

        const storedContent = await fs.readFile(String(saved.absolutePath), 'utf-8');
        expect(storedContent).toBe('ok-local-provider');

        await provider.delete(saved.key);
        await expect(fs.access(String(saved.absolutePath))).rejects.toBeTruthy();
    });

    it('should block s3 provider when runtime activation flag is missing', () => {
        process.env.STORAGE_PROVIDER = 's3';
        process.env.STORAGE_S3_ENABLED = 'false';

        expect(() => createStorageProvider()).toThrow(AppError);
        expect(() => createStorageProvider()).toThrow(/STORAGE_S3_ENABLED/i);
    });

    it('should default s3 region to us-east-1 when omitted', () => {
        process.env.STORAGE_PROVIDER = 's3';
        process.env.STORAGE_S3_ENABLED = 'true';
        process.env.STORAGE_S3_ENDPOINT = 'http://127.0.0.1:9000';
        process.env.STORAGE_S3_BUCKET = 'ementas-signatures-test';
        process.env.STORAGE_S3_ACCESS_KEY_ID = 'test-access-key';
        process.env.STORAGE_S3_SECRET_ACCESS_KEY = 'test-secret-key';
        process.env.STORAGE_S3_REGION = '';

        const provider = createStorageProvider() as unknown as { kind: string; region: string };

        expect(provider.kind).toBe('s3');
        expect(provider.region).toBe('us-east-1');
    });

    it('should throw for unsupported provider', () => {
        process.env.STORAGE_PROVIDER = 'ftp';

        expect(() => createStorageProvider()).toThrow(AppError);
        expect(() => createStorageProvider()).toThrow(/Unsupported STORAGE_PROVIDER/i);
    });
});
