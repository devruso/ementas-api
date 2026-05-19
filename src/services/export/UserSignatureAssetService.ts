import { User } from '../../entities/User';
import { createStorageProvider } from '../storage';
import { StorageProviderKind } from '../storage/types';
import { ProcessedSignatureImage, SignatureImageProcessor } from './SignatureImageProcessor';

type SignatureAwareUser = Pick<User, 'signatureFileKey' | 'signatureFileProvider' | 'signatureFileContentType'>;

export class UserSignatureAssetService {
    constructor(private readonly imageProcessor = new SignatureImageProcessor()) {}

    private supportsInlineDocumentImage(user?: SignatureAwareUser | null) {
        return Boolean(user?.signatureFileKey) && /^image\//i.test(String(user?.signatureFileContentType || ''));
    }

    async loadForDocument(user?: SignatureAwareUser | null): Promise<ProcessedSignatureImage | null> {
        if (!this.supportsInlineDocumentImage(user)) {
            return null;
        }

        const provider = createStorageProvider(user?.signatureFileProvider as StorageProviderKind | undefined);
        const source = await provider.read(user?.signatureFileKey as string);

        return this.imageProcessor.prepareForDocument(source);
    }
}