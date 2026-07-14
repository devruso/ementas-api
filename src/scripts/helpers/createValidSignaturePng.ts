import zlib from 'zlib';

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

export const createValidSignaturePng = (width: number, height: number): Buffer => {
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
