import path from 'path';
import { Readable } from 'stream';
import {
    CreateBucketCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';

import { AppError } from '../../errors/AppError';
import { FileStorageProvider } from './FileStorageProvider';
import { SaveFileRequest, StoredFileReference } from './types';

export class S3CompatibleFileStorageProvider implements FileStorageProvider {
    readonly kind = 's3' as const;

    private readonly bucketName: string;
    private readonly endpoint: string;
    private readonly region: string;
    private readonly accessKeyId: string;
    private readonly secretAccessKey: string;
    private readonly forcePathStyle: boolean;
    private readonly publicBaseUrl: string;
    private readonly autoCreateBucket: boolean;
    private readonly s3Client: S3Client;
    private bucketReadyPromise?: Promise<void>;

    private sanitizeSegment(value: string, fieldName: string): string {
        const trimmed = value.trim();

        if (!trimmed) {
            throw new AppError(`${fieldName} is required for s3 storage.`, 400);
        }

        if (trimmed.includes('..') || path.isAbsolute(trimmed)) {
            throw new AppError(`${fieldName} must be a relative safe path segment.`, 400);
        }

        return trimmed.replace(/\\/g, '/');
    }

    constructor() {
        this.bucketName = String(process.env.STORAGE_S3_BUCKET || '').trim();
        this.endpoint = String(process.env.STORAGE_S3_ENDPOINT || '').trim();
        this.region = String(process.env.STORAGE_S3_REGION || process.env.AWS_REGION || 'us-east-1').trim() || 'us-east-1';
        this.accessKeyId = String(process.env.STORAGE_S3_ACCESS_KEY_ID || '').trim();
        this.secretAccessKey = String(process.env.STORAGE_S3_SECRET_ACCESS_KEY || '').trim();
        this.forcePathStyle = String(process.env.STORAGE_S3_FORCE_PATH_STYLE || 'true').trim().toLowerCase() === 'true';
        this.publicBaseUrl = String(process.env.STORAGE_S3_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
        this.autoCreateBucket = String(process.env.STORAGE_S3_AUTO_CREATE_BUCKET || 'false').trim().toLowerCase() === 'true';

        if (!this.bucketName || !this.endpoint || !this.accessKeyId || !this.secretAccessKey) {
            throw new AppError(
                'S3-compatible provider requires STORAGE_S3_BUCKET, STORAGE_S3_ENDPOINT, STORAGE_S3_REGION, STORAGE_S3_ACCESS_KEY_ID and STORAGE_S3_SECRET_ACCESS_KEY.',
                500
            );
        }

        this.s3Client = new S3Client({
            region: this.region,
            endpoint: this.endpoint,
            credentials: {
                accessKeyId: this.accessKeyId,
                secretAccessKey: this.secretAccessKey,
            },
            forcePathStyle: this.forcePathStyle,
        });
    }

    private isMissingBucketError(error: unknown) {
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
    }

    private isBucketAlreadyOwnedError(error: unknown) {
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
    }

    private async ensureBucketExists() {
        if (!this.bucketReadyPromise) {
            this.bucketReadyPromise = (async () => {
                try {
                    await this.s3Client.send(new HeadBucketCommand({
                        Bucket: this.bucketName,
                    }));
                    return;
                } catch (error) {
                    if (!this.isMissingBucketError(error)) {
                        throw error;
                    }
                }

                try {
                    await this.s3Client.send(new CreateBucketCommand({
                        Bucket: this.bucketName,
                    }));
                } catch (error) {
                    if (!this.isBucketAlreadyOwnedError(error)) {
                        throw error;
                    }
                }

                await this.s3Client.send(new HeadBucketCommand({
                    Bucket: this.bucketName,
                }));
            })().catch((error) => {
                this.bucketReadyPromise = undefined;
                throw error;
            });
        }

        await this.bucketReadyPromise;
    }

    private async streamToBuffer(body: unknown): Promise<Buffer> {
        if (Buffer.isBuffer(body)) {
            return body;
        }

        if (body instanceof Uint8Array) {
            return Buffer.from(body);
        }

        if (!(body instanceof Readable)) {
            throw new AppError('S3-compatible provider returned an unsupported body stream.', 500);
        }

        const chunks: Buffer[] = [];

        for await (const chunk of body) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }

        return Buffer.concat(chunks);
    }

    async save(request: SaveFileRequest): Promise<StoredFileReference> {
        const folder = this.sanitizeSegment(request.folder, 'folder');
        const fileName = this.sanitizeSegment(request.fileName, 'fileName');
        const key = path.posix.join(folder, fileName);

        if (this.autoCreateBucket) {
            await this.ensureBucketExists();
        }

        await this.s3Client.send(new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            Body: request.content,
            ContentType: request.contentType,
        }));

        const publicUrl = this.publicBaseUrl
            ? `${this.publicBaseUrl}/${key}`
            : `${this.endpoint.replace(/\/+$/, '')}/${this.bucketName}/${key}`;

        return {
            provider: this.kind,
            key,
            size: request.content.length,
            contentType: request.contentType,
            publicUrl,
        };
    }

    async read(key: string): Promise<Buffer> {
        const sanitizedKey = this.sanitizeSegment(key, 'key');
        const response = await this.s3Client.send(new GetObjectCommand({
            Bucket: this.bucketName,
            Key: sanitizedKey,
        }));

        return this.streamToBuffer(response.Body);
    }

    async delete(key: string): Promise<void> {
        const sanitizedKey = this.sanitizeSegment(key, 'key');

        await this.s3Client.send(new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: sanitizedKey,
        }));
    }
}
