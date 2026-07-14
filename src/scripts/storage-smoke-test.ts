import crypto from 'crypto';

import { createStorageProvider } from '../services/storage';

const readFlag = (flagName: string) => {
    const prefix = `--${flagName}=`;
    const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));

    if (!match) {
        return undefined;
    }

    return match.slice(prefix.length).trim();
};

const buildProbeFileName = () => {
    const randomSegment = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : crypto.randomBytes(12).toString('hex');

    return `probe-${Date.now()}-${randomSegment}.txt`;
};

async function main() {
    const folder = readFlag('folder') || 'signatures-probe';
    const fileName = readFlag('fileName') || buildProbeFileName();
    const provider = createStorageProvider();
    const endpoint = String(process.env.STORAGE_S3_ENDPOINT || '').trim() || undefined;
    const bucket = String(process.env.STORAGE_S3_BUCKET || '').trim() || undefined;
    const region = String(process.env.STORAGE_S3_REGION || process.env.AWS_REGION || 'us-east-1').trim() || 'us-east-1';
    const content = Buffer.from(`ementas-storage-smoke-test ${new Date().toISOString()}`, 'utf-8');

    console.log('[storage-smoke-test] starting', {
        provider: provider.kind,
        folder,
        endpoint,
        bucket,
        region,
    });

    const saved = await provider.save({
        folder,
        fileName,
        content,
        contentType: 'text/plain; charset=utf-8',
    });

    console.log('[storage-smoke-test] saved', {
        provider: saved.provider,
        key: saved.key,
        size: saved.size,
        publicUrl: saved.publicUrl,
    });

    const loaded = await provider.read(saved.key);

    if (!loaded.equals(content)) {
        throw new Error('Storage smoke test read/write mismatch.');
    }

    await provider.delete(saved.key);

    console.log('[storage-smoke-test] success', {
        provider: saved.provider,
        key: saved.key,
    });
}

main().catch((error) => {
    const details = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: String(error) };

    console.error('[storage-smoke-test] failed', {
        provider: String(process.env.STORAGE_PROVIDER || 'local').trim().toLowerCase() || 'local',
        s3Enabled: String(process.env.STORAGE_S3_ENABLED || '').trim(),
        endpoint: String(process.env.STORAGE_S3_ENDPOINT || '').trim(),
        bucket: String(process.env.STORAGE_S3_BUCKET || '').trim(),
        region: String(process.env.STORAGE_S3_REGION || process.env.AWS_REGION || 'us-east-1').trim() || 'us-east-1',
        ...details,
    });

    process.exit(1);
});
