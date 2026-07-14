import zlib from 'zlib';

type SessionResponse = {
    token?: string;
    accessToken?: string;
};

type UploadResponse = {
    signatureFileKey?: string;
    signatureFileProvider?: string;
    signatureFileContentType?: string;
    signatureFileSize?: number;
    signatureFileHash?: string;
    signatureUpdatedAt?: string;
};

const getArgValue = (flagName: string) => {
    const prefix = `${flagName}=`;
    const directMatch = process.argv.slice(2).find((arg) => arg.startsWith(prefix));

    if (directMatch) {
        return directMatch.slice(prefix.length).trim();
    }

    const flagIndex = process.argv.indexOf(flagName);

    if (flagIndex >= 0 && process.argv[flagIndex + 1]) {
        return process.argv[flagIndex + 1].trim();
    }

    return undefined;
};

const hasFlag = (flagName: string) =>
    process.argv.slice(2).some((arg) => arg === flagName || arg.startsWith(`${flagName}=`));

const buildCrc32Table = () => {
    const table = new Uint32Array(256);

    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = (value & 1) ? ((0xedb88320 ^ (value >>> 1)) >>> 0) : (value >>> 1);
        }
        table[index] = value >>> 0;
    }

    return table;
};

const CRC32_TABLE = buildCrc32Table();

const crc32 = (buffer: Buffer): number => {
    let crc = 0xffffffff;

    for (let index = 0; index < buffer.length; index += 1) {
        crc = CRC32_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (chunkType: string, chunkData: Buffer) => {
    const typeBuffer = Buffer.from(chunkType, 'ascii');
    const size = Buffer.alloc(4);
    size.writeUInt32BE(chunkData.length, 0);

    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, chunkData])), 0);

    return Buffer.concat([size, typeBuffer, chunkData, crc]);
};

const createValidSignaturePng = (width: number, height: number): Buffer => {
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const rowLength = (width * 4) + 1;
    const raw = Buffer.alloc(rowLength * height, 0);

    for (let row = 0; row < height; row += 1) {
        const rowOffset = row * rowLength;
        raw[rowOffset] = 0;

        for (let column = 0; column < width; column += 1) {
            const pixelOffset = rowOffset + 1 + (column * 4);
            raw[pixelOffset] = 0;
            raw[pixelOffset + 1] = 0;
            raw[pixelOffset + 2] = 0;
            raw[pixelOffset + 3] = 255;
        }
    }

    const idat = zlib.deflateSync(raw);

    return Buffer.concat([
        pngSignature,
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', idat),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
};

const requestJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, init);
    const rawText = await response.text();

    let parsed: unknown = {};

    if (rawText) {
        try {
            parsed = JSON.parse(rawText);
        } catch {
            parsed = { rawText };
        }
    }

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${JSON.stringify(parsed)}`);
    }

    return parsed as T;
};

const requestBinary = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    const arrayBuffer = await response.arrayBuffer();

    if (!response.ok) {
        const bodyText = Buffer.from(arrayBuffer).toString('utf-8');
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${bodyText}`);
    }

    return {
        contentType: response.headers.get('content-type') || '',
        content: Buffer.from(arrayBuffer),
    };
};

async function main() {
    const baseUrl = (getArgValue('--baseUrl') || process.env.API_BASE_URL || 'http://127.0.0.1:3333').replace(/\/+$/, '');
    const email = getArgValue('--email') || process.env.SIGNATURE_TEST_EMAIL;
    const password = getArgValue('--password') || process.env.SIGNATURE_TEST_PASSWORD;
    const signature = getArgValue('--signature') || 'Assina123!';
    const width = Number(getArgValue('--width') || 420);
    const height = Number(getArgValue('--height') || 120);

    if (hasFlag('--skipTlsValidation')) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    if (!email || !password) {
        throw new Error('Informe --email e --password para validar o upload de assinatura.');
    }

    console.log('[signature-upload-flow] logging in', {
        baseUrl,
        email,
    });

    const session = await requestJson<SessionResponse>(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
    });

    const token = session.accessToken || session.token;

    if (!token) {
        throw new Error('Resposta de login nao retornou token/accessToken.');
    }

    const png = createValidSignaturePng(width, height);
    const formData = new FormData();
    formData.append('signature', signature);
    formData.append(
        'signatureFile',
        new Blob([png], { type: 'image/png' }),
        'assinatura-validacao.png'
    );

    console.log('[signature-upload-flow] uploading signature file', {
        width,
        height,
        bytes: png.length,
    });

    const uploadResult = await requestJson<UploadResponse>(`${baseUrl}/api/users/update/signature/file`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${token}`,
        },
        body: formData,
    });

    console.log('[signature-upload-flow] upload success', {
        signatureFileKey: uploadResult.signatureFileKey,
        signatureFileProvider: uploadResult.signatureFileProvider,
        signatureFileContentType: uploadResult.signatureFileContentType,
        signatureFileSize: uploadResult.signatureFileSize,
        signatureFileHash: uploadResult.signatureFileHash,
        signatureUpdatedAt: uploadResult.signatureUpdatedAt,
    });

    const preview = await requestBinary(`${baseUrl}/api/users/signature/file`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    console.log('[signature-upload-flow] preview success', {
        contentType: preview.contentType,
        bytes: preview.content.length,
    });
}

main().catch((error) => {
    const details = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: String(error) };

    console.error('[signature-upload-flow] failed', details);
    process.exit(1);
});
