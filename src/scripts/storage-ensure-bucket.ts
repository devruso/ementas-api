import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

const required = (fieldName: string, value?: string) => {
    const normalized = String(value || '').trim();

    if (!normalized) {
        throw new Error(`${fieldName} is required.`);
    }

    return normalized;
};

const isMissingBucketError = (error: unknown) => {
    const details = error as {
        name?: string;
        Code?: string;
        code?: string;
        message?: string;
        $metadata?: { httpStatusCode?: number };
    };

    const rawCode = String(details?.Code || details?.code || details?.name || '').trim();
    const message = String(details?.message || '').trim();
    const status = details?.$metadata?.httpStatusCode;

    return rawCode === 'NoSuchBucket'
        || rawCode === 'NotFound'
        || status === 404
        || /bucket does not exist/i.test(message);
};

const isBucketAlreadyOwnedError = (error: unknown) => {
    const details = error as {
        name?: string;
        Code?: string;
        code?: string;
        message?: string;
        $metadata?: { httpStatusCode?: number };
    };

    const rawCode = String(details?.Code || details?.code || details?.name || '').trim();
    const message = String(details?.message || '').trim();
    const status = details?.$metadata?.httpStatusCode;

    return rawCode === 'BucketAlreadyOwnedByYou'
        || rawCode === 'BucketAlreadyExists'
        || status === 409
        || /bucket.*already/i.test(message);
};

async function main() {
    const bucket = required('STORAGE_S3_BUCKET', process.env.STORAGE_S3_BUCKET);
    const endpoint = required('STORAGE_S3_ENDPOINT', process.env.STORAGE_S3_ENDPOINT);
    const region = String(process.env.STORAGE_S3_REGION || process.env.AWS_REGION || 'us-east-1').trim() || 'us-east-1';
    const accessKeyId = required('STORAGE_S3_ACCESS_KEY_ID', process.env.STORAGE_S3_ACCESS_KEY_ID);
    const secretAccessKey = required('STORAGE_S3_SECRET_ACCESS_KEY', process.env.STORAGE_S3_SECRET_ACCESS_KEY);
    const forcePathStyle = String(process.env.STORAGE_S3_FORCE_PATH_STYLE || 'true').trim().toLowerCase() === 'true';

    const s3Client = new S3Client({
        region,
        endpoint,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
        forcePathStyle,
    });

    console.log('[storage-ensure-bucket] starting', {
        endpoint,
        bucket,
        region,
        forcePathStyle,
    });

    try {
        await s3Client.send(new HeadBucketCommand({
            Bucket: bucket,
        }));

        console.log('[storage-ensure-bucket] bucket already exists', {
            bucket,
        });
        return;
    } catch (error) {
        if (!isMissingBucketError(error)) {
            throw error;
        }
    }

    try {
        await s3Client.send(new CreateBucketCommand({
            Bucket: bucket,
        }));
    } catch (error) {
        if (!isBucketAlreadyOwnedError(error)) {
            throw error;
        }
    }

    await s3Client.send(new HeadBucketCommand({
        Bucket: bucket,
    }));

    console.log('[storage-ensure-bucket] bucket created and verified', {
        bucket,
    });
}

main().catch((error) => {
    const details = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: String(error) };

    console.error('[storage-ensure-bucket] failed', details);
    process.exit(1);
});
