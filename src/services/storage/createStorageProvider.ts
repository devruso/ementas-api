import { AppError } from '../../errors/AppError';
import { FileStorageProvider } from './FileStorageProvider';
import { LocalFileStorageProvider } from './LocalFileStorageProvider';
import { S3CompatibleFileStorageProvider } from './S3CompatibleFileStorageProvider';
import { StorageProviderKind } from './types';

const TRUE_VALUE = 'true';

const isTrue = (rawValue?: string) => String(rawValue || '').trim().toLowerCase() === TRUE_VALUE;

export const createStorageProvider = (preferredProvider?: StorageProviderKind): FileStorageProvider => {
    const provider = String(preferredProvider || process.env.STORAGE_PROVIDER || 'local').trim().toLowerCase();

    if (provider === 'local') {
        return new LocalFileStorageProvider();
    }

    if (provider === 's3') {
        if (!isTrue(process.env.STORAGE_S3_ENABLED)) {
            throw new AppError(
                'STORAGE_PROVIDER=s3 is configured, but STORAGE_S3_ENABLED is not true. Keep local or explicitly enable S3 runtime.',
                500
            );
        }

        return new S3CompatibleFileStorageProvider();
    }

    throw new AppError(`Unsupported STORAGE_PROVIDER value: ${provider}. Use local or s3.`, 500);
};
