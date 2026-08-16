import crypto from 'crypto';

import { createStorageProvider } from '../services/storage';
import { createValidSignaturePng } from './helpers/createValidSignaturePng';

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

    return `probe-${Date.now()}-${randomSegment}.png`;
};

async function main() {
    const folder = readFlag('folder') || 'signatures-probe';
    const fileName = readFlag('fileName') || buildProbeFileName();
    const readKey = readFlag('readKey');
    const keep = readFlag('keep') === 'true';
    const deleteAfterRead = readFlag('deleteAfterRead') === 'true';
    const width = Number(readFlag('width') || 420);
    const height = Number(readFlag('height') || 120);
    const provider = createStorageProvider();
    const endpoint = String(process.env.STORAGE_S3_ENDPOINT || '').trim() || undefined;
    const bucket = String(process.env.STORAGE_S3_BUCKET || '').trim() || undefined;
    const region = String(process.env.STORAGE_S3_REGION || process.env.AWS_REGION || 'us-east-1').trim() || 'us-east-1';
    const content = createValidSignaturePng(width, height);

    console.log('[storage-smoke-test] starting', {
        provider: provider.kind,
        folder,
        endpoint,
        bucket,
        region,
        width,
        height,
    });

    if (readKey) {
        const loaded = await provider.read(readKey);

        if (!loaded.equals(content)) {
            throw new Error('Storage persistence smoke test read mismatch.');
        }

        if (deleteAfterRead) {
            await provider.delete(readKey);
        }

        console.log('[storage-smoke-test] persisted-object-success', {
            provider: provider.kind,
            key: readKey,
            deleted: deleteAfterRead,
        });
        return;
    }

    const saved = await provider.save({
        folder,
        fileName,
        content,
        contentType: 'image/png',
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

    if (!keep) {
        await provider.delete(saved.key);
    }

    console.log('[storage-smoke-test] success', {
        provider: saved.provider,
        key: saved.key,
        kept: keep,
    });
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const hint = /NoSuchBucket|bucket does not exist/i.test(message)
        ? 'Bucket ausente. Rode storage-ensure-bucket ou ative STORAGE_S3_AUTO_CREATE_BUCKET=true.'
        : undefined;
    const details = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: String(error) };

    console.error('[storage-smoke-test] failed', {
        provider: String(process.env.STORAGE_PROVIDER || 'local').trim().toLowerCase() || 'local',
        s3Enabled: String(process.env.STORAGE_S3_ENABLED || '').trim(),
        endpoint: String(process.env.STORAGE_S3_ENDPOINT || '').trim(),
        bucket: String(process.env.STORAGE_S3_BUCKET || '').trim(),
        region: String(process.env.STORAGE_S3_REGION || process.env.AWS_REGION || 'us-east-1').trim() || 'us-east-1',
        hint,
        ...details,
    });

    process.exit(1);
});
