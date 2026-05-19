import { SaveFileRequest, StoredFileReference } from './types';

export interface FileStorageProvider {
    readonly kind: 'local' | 's3';

    save(request: SaveFileRequest): Promise<StoredFileReference>;
    read(key: string): Promise<Buffer>;
    delete(key: string): Promise<void>;
}
