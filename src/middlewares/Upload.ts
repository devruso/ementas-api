import multer from 'multer';
import { AppError } from '../errors/AppError';

const supportedMimeTypes = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const uploadDraftImport = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1,
    },
    fileFilter: (_request, file, callback) => {
        if (!supportedMimeTypes.has(file.mimetype)) {
            callback(new AppError('Formato de arquivo nao suportado. Envie um PDF ou DOCX.', 400));
            return;
        }

        callback(null, true);
    },
});

const supportedSignatureMimeTypes = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
]);

const uploadUserSignatureFile = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 2 * 1024 * 1024,
        files: 1,
    },
    fileFilter: (_request, file, callback) => {
        if (!supportedSignatureMimeTypes.has(file.mimetype)) {
            callback(new AppError('Formato de assinatura nao suportado. Envie PNG, JPG ou WEBP.', 400));
            return;
        }

        callback(null, true);
    },
});

export { uploadDraftImport, uploadUserSignatureFile };