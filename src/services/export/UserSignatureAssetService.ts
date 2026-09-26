import crypto from 'crypto';
import { User } from '../../entities/User';
import { createStorageProvider } from '../storage';
import { StorageProviderKind } from '../storage/types';
import { ProcessedSignatureImage, SignatureImageProcessor } from './SignatureImageProcessor';

export type SignatureAssetReference = Pick<
User,
'signatureFileKey' | 'signatureFileProvider' | 'signatureFileContentType' | 'signatureFileSize' | 'signatureFileHash'
>;

export class UserSignatureAssetService {
    constructor(private readonly imageProcessor = new SignatureImageProcessor()) {}

    private supportsInlineDocumentImage(reference?: SignatureAssetReference | null) {
        return Boolean(reference?.signatureFileKey)
            && /^image\//i.test(String(reference?.signatureFileContentType || ''));
    }

    async loadForDocument(reference?: SignatureAssetReference | null): Promise<ProcessedSignatureImage | null> {
        if (!this.supportsInlineDocumentImage(reference)) {
            return null;
        }

        const provider = createStorageProvider(reference?.signatureFileProvider as StorageProviderKind | undefined);
        const source = await provider.read(reference?.signatureFileKey as string);

        return this.imageProcessor.prepareForDocument(source);
    }

    async archiveForApproval(
        reference?: SignatureAssetReference | null
    ): Promise<SignatureAssetReference | null> {
        if (!this.supportsInlineDocumentImage(reference)) {
            return null;
        }

        const provider = createStorageProvider(reference?.signatureFileProvider as StorageProviderKind | undefined);
        const source = await provider.read(reference?.signatureFileKey as string);
        const extension = String(reference?.signatureFileContentType || '').split('/')[1] || 'png';
        const saved = await provider.save({
            folder: 'approval-signatures',
            fileName: `${crypto.randomUUID()}.${extension.replace('jpeg', 'jpg')}`,
            content: source,
            contentType: reference?.signatureFileContentType,
        });

        return {
            signatureFileKey: saved.key,
            signatureFileProvider: saved.provider,
            signatureFileContentType: saved.contentType || reference?.signatureFileContentType,
            signatureFileSize: saved.size,
            signatureFileHash: crypto.createHash('sha256').update(source).digest('hex'),
        };
    }

    async deleteArchived(reference?: SignatureAssetReference | null) {
        if (!reference?.signatureFileKey || !reference.signatureFileProvider) {
            return;
        }

        const provider = createStorageProvider(reference.signatureFileProvider as StorageProviderKind);
        await provider.delete(reference.signatureFileKey);
    }
}
