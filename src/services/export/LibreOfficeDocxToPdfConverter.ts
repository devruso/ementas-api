import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import type { DocxToPdfConversionRequest, DocxToPdfConverter } from './DocxToPdfConverter';

export class LibreOfficeDocxToPdfConverter implements DocxToPdfConverter {
    private readonly converters: string[];
    private readonly timeoutMs: number;

    constructor(options?: { converters?: string[]; timeoutMs?: number }) {
        const envConverter = process.env.LIBREOFFICE_BIN?.trim();
        const defaultConverters = [
            ...(envConverter ? [envConverter] : []),
            'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
            'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
            '/usr/bin/libreoffice',
            '/usr/bin/soffice',
            'soffice',
            'libreoffice',
        ];

        this.converters = options?.converters ?? defaultConverters;
        this.timeoutMs = options?.timeoutMs ?? Number(process.env.PDF_CONVERSION_TIMEOUT_MS || 45000);
    }

    convert(request: DocxToPdfConversionRequest): Buffer | null {
        const safeBaseName = request.fileBaseName.replace(/[^A-Za-z0-9._-]/g, '_');
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ementas-export-'));
        const userProfileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ementas-lo-profile-'));
        const docxPath = path.join(tempDirectory, `${safeBaseName}.docx`);
        const pdfPath = path.join(tempDirectory, `${safeBaseName}.pdf`);

        fs.writeFileSync(docxPath, request.docxBuffer);

        for (const converter of this.converters) {
            const baseArgs = [
                '--headless',
                '--nologo',
                '--nodefault',
                '--nofirststartwizard',
                '--norestore',
                '--convert-to',
                'pdf',
                '--outdir',
                tempDirectory,
                docxPath,
            ];
            const attempts: string[][] = [
                [
                    '--headless',
                    '--nologo',
                    '--nodefault',
                    '--nofirststartwizard',
                    '--norestore',
                    `-env:UserInstallation=${this.toFileUri(userProfileDirectory)}`,
                    '--convert-to',
                    'pdf',
                    '--outdir',
                    tempDirectory,
                    docxPath,
                ],
                baseArgs,
            ];

            for (const args of attempts) {
                const result = spawnSync(converter, args, {
                    stdio: 'pipe',
                    timeout: this.timeoutMs,
                });

                if (result.status === 0 && fs.existsSync(pdfPath)) {
                    const pdfBuffer = fs.readFileSync(pdfPath);
                    fs.rmSync(tempDirectory, { recursive: true, force: true });
                    fs.rmSync(userProfileDirectory, { recursive: true, force: true });

                    return pdfBuffer;
                }
            }
        }

        fs.rmSync(tempDirectory, { recursive: true, force: true });
        fs.rmSync(userProfileDirectory, { recursive: true, force: true });
        return null;
    }

    private toFileUri(value: string) {
        const resolvedPath = path.resolve(value).replace(/\\/g, '/');
        if (/^[a-zA-Z]:\//.test(resolvedPath)) {
            return `file:///${resolvedPath}`;
        }

        return `file://${resolvedPath}`;
    }
}


