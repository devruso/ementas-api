import { describe, expect, it } from '@jest/globals';

import { AppError } from '../errors/AppError';
import { SignatureImageUploadValidator } from '../services/signature/SignatureImageUploadValidator';

function createMulterFile(buffer: Buffer, mimetype: string, originalname = 'assinatura.png'): Express.Multer.File {
    return {
        fieldname: 'signatureFile',
        originalname,
        encoding: '7bit',
        mimetype,
        size: buffer.length,
        destination: '',
        filename: '',
        path: '',
        buffer,
        stream: undefined as never,
    };
}

function createPngBuffer(width: number, height: number): Buffer {
    const buffer = Buffer.alloc(33, 0);
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

    signature.forEach((value, index) => {
        buffer[index] = value;
    });

    buffer.writeUInt32BE(13, 8);
    buffer.write('IHDR', 12, 4, 'ascii');
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);

    return buffer;
}

function createJpegBuffer(width: number, height: number): Buffer {
    return Buffer.from([
        0xff, 0xd8,
        0xff, 0xc0,
        0x00, 0x11,
        0x08,
        (height >> 8) & 0xff,
        height & 0xff,
        (width >> 8) & 0xff,
        width & 0xff,
        0x03,
        0x01, 0x11, 0x00,
        0x02, 0x11, 0x00,
        0x03, 0x11, 0x00,
        0xff, 0xd9,
    ]);
}

function createWebpVp8xBuffer(width: number, height: number): Buffer {
    const buffer = Buffer.alloc(30, 0);
    buffer.write('RIFF', 0, 4, 'ascii');
    buffer.writeUInt32LE(buffer.length - 8, 4);
    buffer.write('WEBP', 8, 4, 'ascii');
    buffer.write('VP8X', 12, 4, 'ascii');
    buffer.writeUInt32LE(10, 16);

    const widthMinusOne = width - 1;
    const heightMinusOne = height - 1;

    buffer[24] = widthMinusOne & 0xff;
    buffer[25] = (widthMinusOne >> 8) & 0xff;
    buffer[26] = (widthMinusOne >> 16) & 0xff;

    buffer[27] = heightMinusOne & 0xff;
    buffer[28] = (heightMinusOne >> 8) & 0xff;
    buffer[29] = (heightMinusOne >> 16) & 0xff;

    return buffer;
}

describe('SignatureImageUploadValidator', () => {
    it('deve normalizar tipo real do arquivo quando o mimetype vier inconsistente', () => {
        const png = createPngBuffer(420, 120);
        const file = createMulterFile(png, 'image/jpeg', 'assinatura.jpeg');

        const normalized = SignatureImageUploadValidator.validateAndNormalize(file);

        expect(normalized.contentType).toBe('image/png');
        expect(normalized.extension).toBe('png');
        expect(normalized.widthPx).toBe(420);
        expect(normalized.heightPx).toBe(120);
    });

    it('deve aceitar JPEG dentro dos limites esperados', () => {
        const jpeg = createJpegBuffer(480, 130);
        const file = createMulterFile(jpeg, 'image/jpeg', 'assinatura.jpg');

        const normalized = SignatureImageUploadValidator.validateAndNormalize(file);

        expect(normalized.contentType).toBe('image/jpeg');
        expect(normalized.extension).toBe('jpg');
        expect(normalized.widthPx).toBe(480);
        expect(normalized.heightPx).toBe(130);
    });

    it('deve aceitar WEBP dentro dos limites esperados', () => {
        const webp = createWebpVp8xBuffer(600, 140);
        const file = createMulterFile(webp, 'image/webp', 'assinatura.webp');

        const normalized = SignatureImageUploadValidator.validateAndNormalize(file);

        expect(normalized.contentType).toBe('image/webp');
        expect(normalized.extension).toBe('webp');
        expect(normalized.widthPx).toBe(600);
        expect(normalized.heightPx).toBe(140);
    });

    it('deve rejeitar imagem muito pequena', () => {
        const tooSmall = createPngBuffer(100, 30);

        expect(() => SignatureImageUploadValidator.validateAndNormalize(createMulterFile(tooSmall, 'image/png')))
            .toThrow(new AppError('A imagem de assinatura e muito pequena. Minimo: 120x40px.', 400));
    });

    it('deve rejeitar arquivo maior que 2MB', () => {
        const oversized = Buffer.alloc((2 * 1024 * 1024) + 1, 0);

        expect(() => SignatureImageUploadValidator.validateAndNormalize(createMulterFile(oversized, 'image/png')))
            .toThrow(new AppError('Arquivo de assinatura excede 2MB.', 400));
    });

    it('deve rejeitar quando formato nao for suportado', () => {
        const invalid = Buffer.from('nao-e-imagem', 'utf-8');

        expect(() => SignatureImageUploadValidator.validateAndNormalize(createMulterFile(invalid, 'text/plain')))
            .toThrow(new AppError('Formato de assinatura nao suportado. Envie PNG, JPG ou WEBP.', 400));
    });
});
