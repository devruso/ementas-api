export type StorageProviderKind = 'local' | 's3';

export type SaveFileRequest = {
    folder: string;
    fileName: string;
    content: Buffer;
    contentType?: string;
};

export type StoredFileReference = {
    provider: StorageProviderKind;
    key: string;
    size: number;
    contentType?: string;
    absolutePath?: string;
    publicUrl?: string;
};
