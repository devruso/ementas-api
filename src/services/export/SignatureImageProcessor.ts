export type ProcessedSignatureImage = {
    buffer: Buffer;
    widthPx: number;
    heightPx: number;
    contentType: 'image/png';
};

export class SignatureImageProcessor {
    async prepareForDocument(source: Buffer): Promise<ProcessedSignatureImage> {
        try {
            const { Jimp } = await import('jimp');
            const image = await Jimp.read(source);
            image.scaleToFit({ w: 420, h: 120 });

            const { data, width, height } = image.bitmap;

            for (let index = 0; index < data.length; index += 4) {
                const red = data[index];
                const green = data[index + 1];
                const blue = data[index + 2];
                const alphaIndex = index + 3;
                const brightness = (red + green + blue) / 3;
                const maxDelta = Math.max(
                    Math.abs(red - green),
                    Math.abs(red - blue),
                    Math.abs(green - blue)
                );

                if (brightness >= 248 && maxDelta <= 12) {
                    data[alphaIndex] = 0;
                    continue;
                }

                if (brightness >= 232 && maxDelta <= 16) {
                    data[alphaIndex] = Math.round(data[alphaIndex] * 0.35);
                }
            }

            const buffer = await image.getBuffer('image/png');

            return {
                buffer,
                widthPx: width,
                heightPx: height,
                contentType: 'image/png',
            };
        } catch {
            const fallbackPng = this.tryUsePngWithoutProcessing(source);

            if (fallbackPng) {
                return fallbackPng;
            }

            throw new Error('Falha ao processar assinatura de imagem. Verifique a instalacao do Jimp.');
        }
    }

    private tryUsePngWithoutProcessing(source: Buffer): ProcessedSignatureImage | null {
        if (source.length < 24) {
            return null;
        }

        const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

        for (let index = 0; index < signature.length; index += 1) {
            if (source[index] !== signature[index]) {
                return null;
            }
        }

        if (source.toString('ascii', 12, 16) !== 'IHDR') {
            return null;
        }

        const widthPx = source.readUInt32BE(16);
        const heightPx = source.readUInt32BE(20);

        return {
            buffer: source,
            widthPx,
            heightPx,
            contentType: 'image/png',
        };
    }
}