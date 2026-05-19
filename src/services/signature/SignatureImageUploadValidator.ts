import { AppError } from '../../errors/AppError';

export type SupportedSignatureContentType = 'image/png' | 'image/jpeg' | 'image/webp';

export type NormalizedSignatureImage = {
    buffer: Buffer;
    contentType: SupportedSignatureContentType;
    extension: 'png' | 'jpg' | 'webp';
    widthPx: number;
    heightPx: number;
};

const MAX_BYTES = 2 * 1024 * 1024;
const MIN_WIDTH_PX = 120;
const MIN_HEIGHT_PX = 40;
const MAX_WIDTH_PX = 2400;
const MAX_HEIGHT_PX = 1200;
const MIN_ASPECT_RATIO = 1.5;
const MAX_ASPECT_RATIO = 12;

type ParsedImage = {
    contentType: SupportedSignatureContentType;
    widthPx: number;
    heightPx: number;
};

const JPEG_SOF_MARKERS = new Set([
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf,
]);

export class SignatureImageUploadValidator {
    static validateAndNormalize(file?: Express.Multer.File): NormalizedSignatureImage {
        if (!file?.buffer || file.buffer.length === 0) {
            throw new AppError('Nenhum arquivo de assinatura foi enviado.', 400);
        }

        if (file.buffer.length > MAX_BYTES) {
            throw new AppError('Arquivo de assinatura excede 2MB.', 400);
        }

        const parsed = this.detectImage(file.buffer);

        if (!parsed) {
            throw new AppError('Formato de assinatura nao suportado. Envie PNG, JPG ou WEBP.', 400);
        }

        this.assertDimensions(parsed.widthPx, parsed.heightPx);

        return {
            buffer: file.buffer,
            contentType: parsed.contentType,
            extension: this.extensionFor(parsed.contentType),
            widthPx: parsed.widthPx,
            heightPx: parsed.heightPx,
        };
    }

    private static extensionFor(contentType: SupportedSignatureContentType): 'png' | 'jpg' | 'webp' {
        if (contentType === 'image/png') {
            return 'png';
        }

        if (contentType === 'image/jpeg') {
            return 'jpg';
        }

        return 'webp';
    }

    private static assertDimensions(widthPx: number, heightPx: number) {
        if (widthPx < MIN_WIDTH_PX || heightPx < MIN_HEIGHT_PX) {
            throw new AppError(
                `A imagem de assinatura e muito pequena. Minimo: ${MIN_WIDTH_PX}x${MIN_HEIGHT_PX}px.`,
                400
            );
        }

        if (widthPx > MAX_WIDTH_PX || heightPx > MAX_HEIGHT_PX) {
            throw new AppError(
                `A imagem de assinatura excede o limite permitido. Maximo: ${MAX_WIDTH_PX}x${MAX_HEIGHT_PX}px.`,
                400
            );
        }

        const ratio = widthPx / heightPx;

        if (ratio < MIN_ASPECT_RATIO || ratio > MAX_ASPECT_RATIO) {
            throw new AppError('Proporcao de assinatura invalida. Use uma imagem horizontal.', 400);
        }
    }

    private static detectImage(buffer: Buffer): ParsedImage | null {
        return this.parsePng(buffer) || this.parseJpeg(buffer) || this.parseWebp(buffer);
    }

    private static parsePng(buffer: Buffer): ParsedImage | null {
        if (buffer.length < 24) {
            return null;
        }

        const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

        for (let index = 0; index < signature.length; index += 1) {
            if (buffer[index] !== signature[index]) {
                return null;
            }
        }

        if (buffer.toString('ascii', 12, 16) !== 'IHDR') {
            return null;
        }

        return {
            contentType: 'image/png',
            widthPx: buffer.readUInt32BE(16),
            heightPx: buffer.readUInt32BE(20),
        };
    }

    private static parseJpeg(buffer: Buffer): ParsedImage | null {
        if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
            return null;
        }

        let offset = 2;

        while (offset + 3 < buffer.length) {
            if (buffer[offset] !== 0xff) {
                offset += 1;
                continue;
            }

            const marker = buffer[offset + 1];
            offset += 2;

            if (marker === 0xd8 || marker === 0xd9) {
                continue;
            }

            if (marker === 0xda) {
                break;
            }

            if (offset + 1 >= buffer.length) {
                return null;
            }

            const segmentLength = buffer.readUInt16BE(offset);

            if (segmentLength < 2 || offset + segmentLength > buffer.length) {
                return null;
            }

            if (JPEG_SOF_MARKERS.has(marker)) {
                if (segmentLength < 7) {
                    return null;
                }

                return {
                    contentType: 'image/jpeg',
                    heightPx: buffer.readUInt16BE(offset + 3),
                    widthPx: buffer.readUInt16BE(offset + 5),
                };
            }

            offset += segmentLength;
        }

        return null;
    }

    private static parseWebp(buffer: Buffer): ParsedImage | null {
        if (buffer.length < 30) {
            return null;
        }

        if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
            return null;
        }

        const chunkType = buffer.toString('ascii', 12, 16);

        if (chunkType === 'VP8X') {
            const widthMinusOne = buffer[24] | (buffer[25] << 8) | (buffer[26] << 16);
            const heightMinusOne = buffer[27] | (buffer[28] << 8) | (buffer[29] << 16);

            return {
                contentType: 'image/webp',
                widthPx: widthMinusOne + 1,
                heightPx: heightMinusOne + 1,
            };
        }

        if (chunkType === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
            const bits =
                buffer[21]
                | (buffer[22] << 8)
                | (buffer[23] << 16)
                | (buffer[24] << 24);

            return {
                contentType: 'image/webp',
                widthPx: (bits & 0x3fff) + 1,
                heightPx: ((bits >> 14) & 0x3fff) + 1,
            };
        }

        if (chunkType === 'VP8 ' && buffer.length >= 30) {
            if (!(buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a)) {
                return null;
            }

            const widthRaw = buffer.readUInt16LE(26);
            const heightRaw = buffer.readUInt16LE(28);

            return {
                contentType: 'image/webp',
                widthPx: widthRaw & 0x3fff,
                heightPx: heightRaw & 0x3fff,
            };
        }

        return null;
    }
}
