import path from 'path';
import zlib from 'zlib';
import supertest from 'supertest';
import mammoth from 'mammoth';
import { getConnection } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AdmZip from 'adm-zip';
import { UserController } from '../controllers/UserController';
import { UserInviteService } from '../services/UserInviteService';
import connection from './connection';

/* eslint-disable */
const app = require('../app').app;
const MockExpressRequest = require('mock-express-request');
const MockExpressResponse = require('mock-express-response');
/* eslint-enable */

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_FILE_SIZE = 10 * 1024 * 1024;

jest.setTimeout(30000);

const binaryParser = (res: NodeJS.ReadableStream, callback: (err: Error | null, data: Buffer) => void) => {
    const chunks: Uint8Array[] = [];
    res.on('data', (chunk: Buffer | Uint8Array | string) => {
        if (typeof chunk === 'string') {
            chunks.push(Uint8Array.from(Buffer.from(chunk)));
            return;
        }
        chunks.push(Uint8Array.from(chunk));
    });
    res.on('end', () => {
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const merged = new Uint8Array(totalLength);
        let offset = 0;

        for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
        }

        callback(null, Buffer.from(merged));
    });
};

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
    crc.writeUInt32BE(crc32(Buffer.concat([ typeBuffer, chunkData ])), 0);

    return Buffer.concat([ size, typeBuffer, chunkData, crc ]);
};

const createValidSignaturePng = (width: number, height: number): Buffer => {
    const pngSignature = Buffer.from([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ]);

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type RGBA
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const rowLength = (width * 4) + 1;
    const raw = Buffer.alloc(rowLength * height, 0);

    for (let row = 0; row < height; row += 1) {
        const rowOffset = row * rowLength;
        raw[rowOffset] = 0; // no filter

        for (let column = 0; column < width; column += 1) {
            const pixelOffset = rowOffset + 1 + (column * 4);
            raw[pixelOffset] = 0; // R
            raw[pixelOffset + 1] = 0; // G
            raw[pixelOffset + 2] = 0; // B
            raw[pixelOffset + 3] = 255; // A
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

const createUserAndLogin = async () => {
    const inviteToken = new UserInviteService().generateUserInvite();
    const userController = new UserController();
    const req = new MockExpressRequest({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        params: { inviteToken },
        body: {
            name: 'Test User',
            email: 'test@ufba.br',
            password: 'test123',
        },
    });
    const res = new MockExpressResponse();

    await userController.create(req, res);

    const loginResponse = await supertest(app)
        .post('/api/auth/login')
        .send({ email: 'test@ufba.br', password: 'test123' });

    return loginResponse.body.token as string;
};

describe('Component document flow', () => {
    let token = '';

    beforeAll(async () => {
        await connection.create();
    });

    afterAll(async () => {
        await connection.close();
    });

    beforeEach(async () => {
        token = await createUserAndLogin();
        const signatureResponse = await supertest(app)
            .put('/api/users/update/signature/file')
            .set('Authorization', `Bearer ${token}`)
            .field('signature', 'Assina123!')
            .attach('signatureFile', createValidSignaturePng(420, 120), {
                filename: 'assinatura-e2e.png',
                contentType: 'image/png',
            });

        expect(signatureResponse.statusCode).toBe(200);
    });

    afterEach(async () => {
        await connection.clear();
    });

    it('should not be able to preview a draft import without file', async () => {
        const response = await supertest(app)
            .post('/api/component-drafts/import-preview')
            .set('Authorization', `Bearer ${token}`);

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe('Nenhum arquivo foi enviado para importação.');
    });

    it('should publish without a visual signature and require the login password', async () => {
        const createResponse = await supertest(app)
            .post('/api/components')
            .set('Authorization', `Bearer ${token}`)
            .send({
                code: 'NS01',
                name: 'Disciplina sem assinatura visual',
                department: 'Departamento Teste',
                program: 'Programa de teste',
                semester: '2026.1',
                prerequeriments: 'Nenhum',
                methodology: 'Aulas expositivas',
                objective: 'Validar bloqueio sem assinatura visual',
                syllabus: 'Ementa de teste',
                bibliography: 'SILVA, Joao. Referencia de teste. 2020.',
                modality: 'Presencial',
                learningAssessment: 'Provas e trabalhos',
            });

        expect(createResponse.statusCode).toBe(201);

        const componentResponse = await supertest(app)
            .get('/api/components/NS01')
            .set('Authorization', `Bearer ${token}`);

        await getConnection().query(`
            UPDATE users
            SET signature_file_key = NULL,
                signature_file_provider = NULL,
                signature_file_content_type = NULL,
                signature_file_size = NULL,
                signature_file_hash = NULL
            WHERE email = $1
        `, [ 'test@ufba.br' ]);

        const publicationContextResponse = await supertest(app)
            .get(`/api/component-drafts/${componentResponse.body.draft.id}/publication-context`)
            .set('Authorization', `Bearer ${token}`);

        expect(publicationContextResponse.statusCode).toBe(200);
        expect(publicationContextResponse.body.approverName).toBe('Test User');
        expect(publicationContextResponse.body.hasVisualSignature).toBe(false);
        expect(publicationContextResponse.body.agreementNumber).toMatch(/^ATA-\d{4}-\d{3}$/);

        const wrongPasswordResponse = await supertest(app)
            .post(`/api/component-drafts/${componentResponse.body.draft.id}/approve`)
            .set('Authorization', `Bearer ${token}`)
            .send({ password: 'senha-incorreta' });

        expect(wrongPasswordResponse.statusCode).toBe(403);
        expect(wrongPasswordResponse.body.code).toBe('PUBLICATION_PASSWORD_INVALID');

        const approveResponse = await supertest(app)
            .post(`/api/component-drafts/${componentResponse.body.draft.id}/approve`)
            .set('Authorization', `Bearer ${token}`)
            .send({ password: 'test123' });

        expect(approveResponse.statusCode).toBe(200);
    });

    it('should validate publication from basic references without blocking on optional complementary references', async () => {
        const createResponse = await supertest(app)
            .post('/api/components')
            .set('Authorization', `Bearer ${token}`)
            .send({
                code: 'REF301',
                name: 'Referencias Basicas Suficientes',
                department: 'Bacharelado em Ciencia da Computacao',
                program: 'Conteudo programatico',
                semester: '2026.1',
                prerequeriments: 'NAO_SE_APLICA',
                methodology: 'Aulas expositivas',
                objective: 'Validar referencias basicas',
                syllabus: 'Ementa de teste',
                bibliography: '',
                referencesBasic: [
                    'AUTOR, A. Livro um. 2020.',
                    'AUTOR, B. Livro dois. 2021.',
                    'AUTOR, C. Livro tres. 2022.',
                ].join('\n'),
                referencesComplementary: 'Material complementar ainda sem ano',
                modality: 'DISCIPLINA',
                learningAssessment: 'Provas e trabalhos',
            });

        expect(createResponse.statusCode).toBe(201);
        const componentResponse = await supertest(app)
            .get('/api/components/REF301')
            .set('Authorization', `Bearer ${token}`);
        const approveResponse = await supertest(app)
            .post(`/api/component-drafts/${componentResponse.body.draft.id}/approve`)
            .set('Authorization', `Bearer ${token}`)
            .send({ password: 'test123' });

        expect(approveResponse.statusCode).toBe(200);
    });

    it('should publish and export without an image when the persisted signature object is unavailable', async () => {
        const createResponse = await supertest(app)
            .post('/api/components')
            .set('Authorization', `Bearer ${token}`)
            .send({
                code: 'MS01',
                name: 'Disciplina com objeto de assinatura ausente',
                department: 'Departamento Teste',
                program: 'Programa de teste',
                semester: '2026.1',
                prerequeriments: 'Nenhum',
                methodology: 'Aulas expositivas',
                objective: 'Validar bloqueio com objeto ausente',
                syllabus: 'Ementa de teste',
                bibliography: 'SILVA, Joao. Referencia de teste. 2020.',
                modality: 'Presencial',
                learningAssessment: 'Provas e trabalhos',
            });

        expect(createResponse.statusCode).toBe(201);

        const componentResponse = await supertest(app)
            .get('/api/components/MS01')
            .set('Authorization', `Bearer ${token}`);

        await getConnection().query(`
            UPDATE users
            SET signature_file_key = $1
            WHERE email = $2
        `, [ 'signatures/missing-object.png', 'test@ufba.br' ]);

        const approveResponse = await supertest(app)
            .post(`/api/component-drafts/${componentResponse.body.draft.id}/approve`)
            .set('Authorization', `Bearer ${token}`)
            .send({ password: 'test123' });

        expect(approveResponse.statusCode).toBe(200);

        const docExportResponse = await supertest(app)
            .get(`/api/components/${componentResponse.body.id}/export?format=docx`)
            .buffer(true)
            .parse(binaryParser as never)
            .set('Authorization', `Bearer ${token}`);

        expect(docExportResponse.statusCode).toBe(200);
        const exportedDocZip = new AdmZip(docExportResponse.body as Buffer);
        const hasEmbeddedTeacherSignatureAsset = exportedDocZip
            .getEntries()
            .some((entry: { entryName: string }) => /^word\/media\/signature-rId\d+\.png$/.test(entry.entryName));
        expect(hasEmbeddedTeacherSignatureAsset).toBe(false);
    });

    it('should not be able to preview a draft import with unsupported file type', async () => {
        const response = await supertest(app)
            .post('/api/component-drafts/import-preview')
            .set('Authorization', `Bearer ${token}`)
            .attach('file', Buffer.from('invalid'), {
                filename: 'invalid.txt',
                contentType: 'text/plain',
            });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe('Formato de arquivo nao suportado. Envie um PDF ou DOCX.');
    });

    it('should not be able to preview a draft import above file size limit', async () => {
        const response = await supertest(app)
            .post('/api/component-drafts/import-preview')
            .set('Authorization', `Bearer ${token}`)
            .attach('file', Buffer.alloc(MAX_FILE_SIZE + 1, 'a'), {
                filename: 'too-large.docx',
                contentType: DOCX_MIME_TYPE,
            });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe('O arquivo excede o limite de 10MB para importacao.');
    });

    it('should be able to preview a draft import from docx', async () => {
        const fixturePath = path.resolve(__dirname, '../..', 'UFBA_TEMPLATE.docx');

        const response = await supertest(app)
            .post('/api/component-drafts/import-preview')
            .set('Authorization', `Bearer ${token}`)
            .attach('file', fixturePath, {
                contentType: DOCX_MIME_TYPE,
            });

        expect(response.statusCode).toBe(200);
        expect(response.body.fileName).toBe('UFBA_TEMPLATE.docx');
        expect(response.body.mimeType).toBe(DOCX_MIME_TYPE);
        expect(response.body.suggestedDraft.code).toBe('IC045');
        expect(response.body.suggestedDraft.name).toContain('Tópicos');
        expect(response.body.rawText).toContain('PLANO DE ENSINO-APRENDIZAGEM');
        expect(Array.isArray(response.body.warnings)).toBe(true);
    });

    it('should not be able to get component details by code without authentication', async () => {
        const createResponse = await supertest(app)
            .post('/api/components')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${token}`)
            .send({
                code: 'PUB123',
                name: 'Disciplina Publica',
                department: 'Departamento Publico',
                program: 'Programa Publico',
                semester: '2026.1',
                prerequeriments: 'Nenhum',
                methodology: 'Aulas expositivas',
                objective: 'Disponibilizar acesso publico ao detalhe',
                syllabus: 'Ementa publica',
                bibliography: 'Bibliografia publica',
                modality: 'Presencial',
                learningAssessment: 'Provas',
            });

        expect(createResponse.statusCode).toBe(201);

        const componentResponse = await supertest(app)
            .get('/api/components/PUB123');

        expect(componentResponse.statusCode).toBe(401);
    });

    it('should be able to search published disciplines without accent marks', async () => {
        const createResponse = await supertest(app)
            .post('/api/components')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${token}`)
            .send({
                code: 'ACC101',
                name: 'Metodologia e Expressão Técnica',
                department: 'Departamento de Testes',
                program: 'Programa de Teste',
                semester: '2026.1',
                prerequeriments: 'Nenhum',
                methodology: 'Aulas expositivas',
                objective: 'Validar busca sem acento',
                syllabus: 'Ementa de teste',
                bibliography: 'Bibliografia de teste',
                modality: 'Presencial',
                learningAssessment: 'Provas',
            });

        expect(createResponse.statusCode).toBe(201);

        const searchResponse = await supertest(app)
            .get('/api/components')
            .set('Authorization', `Bearer ${token}`)
            .query({ search: 'expressao' });

        expect(searchResponse.statusCode).toBe(200);
        expect(searchResponse.body.results.some((component: { code: string }) => component.code === 'ACC101'))
            .toBe(true);
    });

    it('should return the exact published component by code even when there are similar codes', async () => {
        const similarComponentResponse = await supertest(app)
            .post('/api/components')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${token}`)
            .send({
                code: 'IIC045',
                name: 'Disciplina Publicada Similar',
                department: 'Departamento Similar',
                program: 'Programa Similar',
                semester: '2026.1',
                prerequeriments: 'Nenhum',
                methodology: 'Aulas expositivas',
                objective: 'Validar busca exata em componente publicado',
                syllabus: 'Ementa Similar',
                bibliography: 'Bibliografia Similar',
                modality: 'Presencial',
                learningAssessment: 'Provas',
            });

        expect(similarComponentResponse.statusCode).toBe(201);

        const targetComponentResponse = await supertest(app)
            .post('/api/components')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${token}`)
            .send({
                code: 'IC045',
                name: 'Disciplina Publicada Alvo',
                department: 'Departamento Alvo',
                program: 'Programa Alvo',
                semester: '2026.1',
                prerequeriments: 'Nenhum',
                methodology: 'Aulas expositivas',
                objective: 'Validar busca exata em componente publicado',
                syllabus: 'Ementa Alvo',
                bibliography: 'Bibliografia Alvo',
                modality: 'Presencial',
                learningAssessment: 'Provas',
            });

        expect(targetComponentResponse.statusCode).toBe(201);

        const getByCodeResponse = await supertest(app)
            .get('/api/components/ic045')
            .set('Authorization', `Bearer ${token}`);

        expect(getByCodeResponse.statusCode).toBe(200);
        expect(getByCodeResponse.body.code).toBe('IC045');
        expect(getByCodeResponse.body.name).toBe('Disciplina Publicada Alvo');
    });

    it('should return the exact draft by code even when there are similar codes', async () => {
        const similarDraftResponse = await supertest(app)
            .post('/api/component-drafts')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${token}`)
            .send({
                code: 'IIC045',
                name: 'Disciplina Similar',
                department: 'Departamento Similar',
                semester: '2026.1',
                modality: 'Presencial',
                program: 'Programa Similar',
                objective: 'Objetivo Similar',
                syllabus: 'Ementa Similar',
                methodology: 'Metodologia Similar',
                learningAssessment: 'Avaliacao Similar',
                bibliography: 'Bibliografia Similar',
                prerequeriments: 'Nenhum',
            });

        expect(similarDraftResponse.statusCode).toBe(201);

        const targetDraftResponse = await supertest(app)
            .post('/api/component-drafts')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${token}`)
            .send({
                code: 'IC045',
                name: 'Disciplina Alvo',
                department: 'Departamento Alvo',
                semester: '2026.1',
                modality: 'Presencial',
                program: 'Programa Alvo',
                objective: 'Objetivo Alvo',
                syllabus: 'Ementa Alvo',
                methodology: 'Metodologia Alvo',
                learningAssessment: 'Avaliacao Alvo',
                bibliography: 'Bibliografia Alvo',
                prerequeriments: 'Nenhum',
            });

        expect(targetDraftResponse.statusCode).toBe(201);

        const getByCodeResponse = await supertest(app)
            .get('/api/component-drafts/ic045')
            .set('Authorization', `Bearer ${token}`);

        expect(getByCodeResponse.statusCode).toBe(200);
        expect(getByCodeResponse.body.code).toBe('IC045');
        expect(getByCodeResponse.body.name).toBe('Disciplina Alvo');
    });

    it('should ignore non-whitelisted fields when updating a published component', async () => {
        const createResponse = await supertest(app)
            .post('/api/components')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${token}`)
            .send({
                code: 'SAFE90',
                name: 'Disciplina Segura',
                department: 'Departamento Seguro',
                program: 'Programa Seguro',
                semester: '2026.1',
                prerequeriments: 'Nenhum',
                methodology: 'Aulas expositivas',
                objective: 'Validar filtro de payload no update',
                syllabus: 'Ementa segura',
                bibliography: 'Bibliografia segura',
                modality: 'Presencial',
                learningAssessment: 'Provas',
            });

        expect(createResponse.statusCode).toBe(201);

        const createdComponentId = createResponse.body.id;
        const originalUserId = createResponse.body.userId;

        const updateResponse = await supertest(app)
            .put(`/api/components/${createdComponentId}`)
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Disciplina Segura Atualizada',
                userId: 'malicious-user-id',
                status: 'draft',
                createdAt: '2030-01-01T00:00:00.000Z',
            });

        expect(updateResponse.statusCode).toBe(200);
        expect(updateResponse.body.name).toBe('Disciplina Segura Atualizada');
        expect(updateResponse.body.userId).toBe(originalUserId);
        expect(updateResponse.body.status).toBe('published');
    });

    it('should be able to export component pdf with approval metadata when available', async () => {
        const createResponse = await supertest(app)
            .post('/api/components')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${token}`)
            .send({
                code: 'TEST123',
                name: 'Disciplina Teste',
                department: 'Departamento Teste',
                program: 'Programa Teste',
                semester: '2026.1',
                prerequeriments: 'Nenhum',
                methodology: 'Aulas expositivas',
                objective: 'Validar exportacao',
                syllabus: 'Ementa de teste',
                bibliography: 'SILVA, Joao. Bibliografia de teste. 2020.',
                modality: 'Presencial',
                learningAssessment: 'Provas e trabalhos',
            });

        expect(createResponse.statusCode).toBe(201);

        const componentResponse = await supertest(app)
            .get('/api/components/TEST123')
            .set('Authorization', `Bearer ${token}`);

        expect(componentResponse.statusCode).toBe(200);
        expect(componentResponse.body.draft?.id).toBeDefined();

        const updateDraftResponse = await supertest(app)
            .put(`/api/component-drafts/${componentResponse.body.draft.id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                program: 'Programa Teste Atualizado',
                workload: {
                    studentTheory: 60,
                },
            });

        expect(updateDraftResponse.statusCode).toBe(200);

        const publicationContextResponse = await supertest(app)
            .get(`/api/component-drafts/${componentResponse.body.draft.id}/publication-context`)
            .set('Authorization', `Bearer ${token}`);

        expect(publicationContextResponse.statusCode).toBe(200);
        const expectedAgreementNumber = publicationContextResponse.body.agreementNumber as string;
        const expectedAgreementDate = new Date(publicationContextResponse.body.agreementDate as string);
        const expectedVersionCode = `${String(expectedAgreementDate.getUTCDate()).padStart(2, '0')}${String(expectedAgreementDate.getUTCMonth() + 1).padStart(2, '0')}${expectedAgreementDate.getUTCFullYear()}${expectedAgreementNumber}`;

        const approveResponse = await supertest(app)
            .post(`/api/component-drafts/${componentResponse.body.draft.id}/approve`)
            .set('Authorization', `Bearer ${token}`)
            .send({ password: 'test123' });

        expect(approveResponse.statusCode).toBe(200);

        const approvedComponentResponse = await supertest(app)
            .get('/api/components/TEST123')
            .set('Authorization', `Bearer ${token}`);

        expect(approvedComponentResponse.statusCode).toBe(200);
        expect(
            approvedComponentResponse.body.logs.some(
                (log: {
                    type: string;
                    agreementNumber?: string;
                    versionCode?: string;
                    officialProgram?: string;
                    description?: string;
                }) =>
                    log.type === 'approval'
                    && log.agreementNumber === expectedAgreementNumber
                    && log.versionCode === expectedVersionCode
                    && log.officialProgram === 'Programa Teste Atualizado'
            )
        ).toBe(true);

        const signatureFileResponse = await supertest(app)
            .put('/api/users/update/signature/file')
            .set('Authorization', `Bearer ${token}`)
            .field('signature', 'Assina123!')
            .attach('signatureFile', createValidSignaturePng(420, 120), {
                filename: 'assinatura-oficial.png',
                contentType: 'image/png',
            });

        expect(signatureFileResponse.statusCode).toBe(200);
        expect(signatureFileResponse.body.signatureFileContentType).toBe('image/png');
        expect(signatureFileResponse.body.signatureFileKey).toContain('signatures/');
        expect(signatureFileResponse.body.signatureFileSize).toBeGreaterThan(0);

        expect(
            approvedComponentResponse.body.logs.some(
                (log: {
                    type: string;
                    description?: string;
                }) =>
                    log.type === 'draft_update'
                    && log.description?.includes('program: "Programa Teste" -> "Programa Teste Atualizado"')
                    && log.description?.includes('workload.studentTheory')
                    && log.description?.includes('workload.studentTheory: 0 -> 60')
            )
        ).toBe(true);

        const exportResponse = await supertest(app)
            .get(`/api/components/${componentResponse.body.id}/export`)
            .buffer(true)
            .parse(binaryParser as never)
            .set('Authorization', `Bearer ${token}`);

        expect(exportResponse.statusCode).toBe(200);
        expect(exportResponse.headers['content-type']).toContain('application/pdf');
        expect(Buffer.isBuffer(exportResponse.body)).toBe(true);
        expect(exportResponse.body.length).toBeGreaterThan(0);
        expect((exportResponse.body as Buffer).subarray(0, 5).toString('utf8')).toBe('%PDF-');

        const docExportResponse = await supertest(app)
            .get(`/api/components/${componentResponse.body.id}/export?format=docx`)
            .buffer(true)
            .parse(binaryParser as never)
            .set('Authorization', `Bearer ${token}`);

        expect(docExportResponse.statusCode).toBe(200);
        expect(docExportResponse.headers['content-type']).toContain(
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        );
        expect(docExportResponse.headers['content-disposition']).toContain('TEST123.docx');
        expect(Buffer.isBuffer(docExportResponse.body)).toBe(true);
        expect((docExportResponse.body as Buffer).subarray(0, 2).toString('utf8')).toBe('PK');

        const exportedDocZip = new AdmZip(docExportResponse.body as Buffer);
        const documentXml = exportedDocZip.readAsText('word/document.xml');
        // eslint-disable-next-line no-control-regex
        const invalidXmlControlChars = documentXml.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) ?? [];
        const invalidTabsTextPayload = /<w:tabs>[^<]/.test(documentXml);

        expect(invalidXmlControlChars).toHaveLength(0);
        expect(invalidTabsTextPayload).toBe(false);
        expect(documentXml).toContain('<w:document');
        expect(documentXml).toContain('<w:body');

        expect(documentXml).toContain('TEST123');
        expect(documentXml).toContain('Disciplina Teste');
        expect(documentXml).toContain('Ementa de teste');
        expect(documentXml).not.toContain('IC045');
        expect(documentXml).not.toContain('Tópicos em Sistemas de Informação e Web I');
        expect(documentXml).toContain('Assinatura do docente');
        expect(documentXml).not.toContain('<w:br w:type="page"/>');
        expect(documentXml).toContain('<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>');

        const facultySignatureParagraphMatch = documentXml.match(/<w:p[\s\S]*?Docente\(s\) Responsável\(is\)[\s\S]*?<\/w:p>/);
        const teacherSignatureParagraphMatch = documentXml.match(/<w:p[\s\S]*?Nome:\s+[^_][\s\S]*?Assinatura:[\s\S]*?<\/w:p>/);
        const chiefSignatureLineMatch = documentXml.match(/Nome:\s*_+\s*Assinatura:\s*_+/);

        expect(facultySignatureParagraphMatch).not.toBeNull();
        expect(teacherSignatureParagraphMatch).not.toBeNull();
        expect(chiefSignatureLineMatch).not.toBeNull();
        expect(teacherSignatureParagraphMatch?.[0]).toMatch(/<w:drawing|<w:pict/);

        const approvalMarkerIndex = documentXml.indexOf('Docente(s) Responsável(is)');
        const tableStack: number[] = [];
        const tableTokens = documentXml.matchAll(/<w:tbl(?=[\s>])|<\/w:tbl>/g);

        for (const token of tableTokens) {
            if ((token.index ?? -1) >= approvalMarkerIndex) {
                break;
            }

            if (token[0] === '</w:tbl>') {
                tableStack.pop();
            } else {
                tableStack.push(token.index ?? -1);
            }
        }

        const findTableEnd = (tableStart: number) => {
            let depth = 0;

            for (const token of documentXml.slice(tableStart).matchAll(/<w:tbl(?=[\s>])|<\/w:tbl>/g)) {
                depth += token[0] === '</w:tbl>' ? -1 : 1;

                if (depth === 0) {
                    return tableStart + (token.index ?? 0) + token[0].length;
                }
            }

            return -1;
        };
        const approvalTableStart = tableStack.at(-1) ?? -1;
        const approvalTableEnd = findTableEnd(approvalTableStart);
        const approvalTable = documentXml.slice(approvalTableStart, approvalTableEnd);
        const approvalWrapperStart = tableStack.at(-2) ?? -1;
        const approvalWrapperEnd = findTableEnd(approvalWrapperStart);
        const approvalWrapper = documentXml.slice(approvalWrapperStart, approvalWrapperEnd);
        const approvalRows = approvalTable
            ? Array.from(approvalTable.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)).map((match) => match[0])
            : [];

        expect(approvalMarkerIndex).toBeGreaterThan(-1);
        expect(approvalTable).not.toContain('<w:tblBorders>');
        expect(approvalWrapper).not.toContain('<w:tblBorders>');
        expect(approvalWrapper.slice(0, approvalWrapper.indexOf('Docente(s) Responsável(is)')))
            .not.toContain('<w:top w:val="single"');
        const approvalOuterTableStart = tableStack[0];
        const precedingTableEnd = documentXml.lastIndexOf('</w:tbl>', approvalOuterTableStart) + '</w:tbl>'.length;
        const approvalLeadIn = documentXml.slice(Math.max(0, precedingTableEnd - 5000), approvalMarkerIndex);
        expect(approvalLeadIn.match(/<w:top w:val="single"/g) ?? []).toHaveLength(1);
        expect(approvalRows[0]).toMatch(/<w:bottom\b/);
        expect(approvalRows.every((row) => /<w:cantSplit\s*\/>/.test(row))).toBe(true);
        expect(approvalRows[1]).not.toMatch(/<w:top\b/);

        const hasEmbeddedTeacherSignatureAsset = exportedDocZip
            .getEntries()
            .some((entry: { entryName: string }) => /^word\/media\/signature-rId\d+\.png$/.test(entry.entryName));

        expect(hasEmbeddedTeacherSignatureAsset).toBe(true);

        const paragraphNodes = Array
            .from(documentXml.matchAll(/<w:p[\s\S]*?<\/w:p>/g) as IterableIterator<RegExpMatchArray>)
            .map((match) => match[0]);
        const decodeXml = (value: string) => value
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, '\'')
            .replace(/&amp;/g, '&');
        const paragraphTexts = paragraphNodes.map((paragraph) => Array
            .from(paragraph.matchAll(/<w:t(?=[\s>])[^>]*>([\s\S]*?)<\/w:t>/g) as IterableIterator<RegExpMatchArray>)
            .map((token) => decodeXml(token[1]))
            .join('')
            .replace(/\s+/g, ' ')
            .trim());

        const normalize = (value: string) => value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();

        const findExactIndex = (label: string) => paragraphTexts.findIndex((text) => normalize(text) === normalize(label));
        const modalityHeaderIndex = findExactIndex('MODALIDADE/ SUBMODALIDADE');
        const prereqHeaderIndex = findExactIndex('PRÉ-REQUISITO (POR CURSO)');
        const modalitySearchEndIndex = findExactIndex('CARGA HORÁRIA (docente/turma)');
        expect(modalityHeaderIndex).toBeGreaterThan(-1);
        expect(prereqHeaderIndex).toBeGreaterThan(modalityHeaderIndex);
        expect(modalitySearchEndIndex).toBeGreaterThan(prereqHeaderIndex);

        const modalityValue = paragraphTexts
            .slice(modalityHeaderIndex + 1, modalitySearchEndIndex)
            .find((text) => {
                const normalized = normalize(text);
                return normalized.includes('DISCIPLINA')
                    && (normalized.includes('TEORIC') || normalized.includes('PRAT'));
            });
        expect([ 'Presencial', 'Disciplina Teórico /Prática' ]).toContain(modalityValue);

        const modalityArtifacts = paragraphTexts
            .slice(modalityHeaderIndex + 1, modalitySearchEndIndex)
            .filter((text) => {
                const normalized = normalize(text);
                return normalized.includes('DISCIPLINA')
                    && (normalized.includes('TEORIC') || normalized.includes('PRAT'));
            });
        expect(modalityArtifacts).toHaveLength(1);

        const workloadTables = Array.from(
            documentXml.matchAll(/<w:tbl\b(?:(?!<w:tbl\b)[\s\S])*?<\/w:tbl>/g) as IterableIterator<RegExpMatchArray>
        ).map((match) => match[0]);
        const getNodeText = (nodeXml: string) => Array
            .from(nodeXml.matchAll(/<w:t(?=[\s>])[^>]*>([\s\S]*?)<\/w:t>/g) as IterableIterator<RegExpMatchArray>)
            .map((token) => decodeXml(token[1]))
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
        const getRows = (tableXml: string) => Array
            .from(tableXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g) as IterableIterator<RegExpMatchArray>)
            .map((match) => match[0]);
        const getCells = (rowXml: string) => Array
            .from(rowXml.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g) as IterableIterator<RegExpMatchArray>)
            .map((match) => match[0]);
        const findWorkloadTable = (heading: string) => workloadTables.find((table) => getNodeText(table).includes(heading));

        const studentTable = findWorkloadTable('CARGA HORÁRIA (estudante)');
        const teacherTable = findWorkloadTable('CARGA HORÁRIA (docente/turma)');
        expect(studentTable).toBeDefined();
        expect(teacherTable).toBeDefined();
        expect(studentTable).toContain('<w:tblLayout w:type="fixed"/>');
        expect(teacherTable).toContain('<w:tblLayout w:type="fixed"/>');

        const studentRows = getRows(studentTable as string);
        const teacherRows = getRows(teacherTable as string);
        const studentHeaderCells = getCells(studentRows[1]);
        const studentValueCells = getCells(studentRows[2]);
        const teacherHeaderCells = getCells(teacherRows[1]);
        const teacherValueCells = getCells(teacherRows[2]);

        expect(studentHeaderCells.slice(0, 7).every((cell) => cell.includes('<w:noWrap/>'))).toBe(true);
        expect(teacherHeaderCells.slice(0, 7).every((cell) => cell.includes('<w:noWrap/>'))).toBe(true);
        expect(teacherHeaderCells.slice(8, 14).every((cell) => cell.includes('<w:noWrap/>'))).toBe(true);
        expect(getNodeText(teacherHeaderCells[14] || '')).toBe('');
        expect(getNodeText(teacherHeaderCells[15] || '')).toBe('');
        expect(studentValueCells.slice(0, 7).map(getNodeText)).toEqual([ '0', '0', '0', '0', '0', '60', '60' ]);
        expect(teacherValueCells.slice(0, 7).map(getNodeText)).toEqual([ '0', '0', '0', '0', '0', '0', '0' ]);
        expect(teacherValueCells[7] && getNodeText(teacherValueCells[7])).toBe('');
        expect(teacherValueCells.slice(8, 14).map(getNodeText)).toEqual([ '0', '0', '0', '0', '0', '0' ]);
        expect(teacherValueCells[14] && getNodeText(teacherValueCells[14])).toBe('');

        const mammothExtract = await mammoth.extractRawText({ buffer: docExportResponse.body as Buffer });

        expect(typeof mammothExtract.value).toBe('string');
        expect(mammothExtract.value).toContain('TEST123');
        expect(mammothExtract.value).toContain('Disciplina Teste');
    });

    it('should export official docx with persisted teacher signature image', async () => {
        const createResponse = await supertest(app)
            .post('/api/components')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${token}`)
            .send({
                code: 'SIG123',
                name: 'Disciplina Assinada',
                department: 'Departamento Teste',
                program: 'Programa Teste',
                semester: '2026.1',
                prerequeriments: 'Nenhum',
                methodology: 'Aulas expositivas',
                objective: 'Validar exportacao com assinatura persistida',
                syllabus: 'Ementa de teste',
                bibliography: 'SILVA, Joao. Bibliografia de teste. 2020.',
                modality: 'Presencial',
                learningAssessment: 'Provas e trabalhos',
            });

        expect(createResponse.statusCode).toBe(201);

        const componentResponse = await supertest(app)
            .get('/api/components/SIG123')
            .set('Authorization', `Bearer ${token}`);

        expect(componentResponse.statusCode).toBe(200);

        const approveResponse = await supertest(app)
            .post(`/api/component-drafts/${componentResponse.body.draft.id}/approve`)
            .set('Authorization', `Bearer ${token}`)
            .send({ password: 'test123' });

        expect(approveResponse.statusCode).toBe(200);

        const signatureFileResponse = await supertest(app)
            .put('/api/users/update/signature/file')
            .set('Authorization', `Bearer ${token}`)
            .field('signature', 'Assina123!')
            .attach('signatureFile', createValidSignaturePng(420, 120), {
                filename: 'assinatura-oficial.png',
                contentType: 'image/png',
            });

        expect(signatureFileResponse.statusCode).toBe(200);

        const docExportResponse = await supertest(app)
            .get(`/api/components/${componentResponse.body.id}/export?format=docx`)
            .buffer(true)
            .parse(binaryParser as never)
            .set('Authorization', `Bearer ${token}`);

        expect(docExportResponse.statusCode).toBe(200);
        expect(docExportResponse.headers['content-type']).toContain(
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        );

        const exportedDocZip = new AdmZip(docExportResponse.body as Buffer);
        const documentXml = exportedDocZip.readAsText('word/document.xml');

        expect(documentXml).toContain('Nome: Test User Assinatura:');
        expect(documentXml).toMatch(/<w:drawing|<w:pict/);

        const hasEmbeddedTeacherSignatureAsset = exportedDocZip
            .getEntries()
            .some((entry: { entryName: string }) => /^word\/media\/signature-rId\d+\.png$/.test(entry.entryName));

        expect(hasEmbeddedTeacherSignatureAsset).toBe(true);
    });

    it('should generate unique sequential agreement numbers for consecutive publications', async () => {
        const createFirstResponse = await supertest(app)
            .post('/api/components')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${token}`)
            .send({
                code: 'ATA001',
                name: 'Disciplina ATA 1',
                department: 'Departamento Teste',
                program: 'Programa Teste 1',
                semester: '2026.1',
                prerequeriments: 'Nenhum',
                methodology: 'Aulas expositivas',
                objective: 'Objetivo 1',
                syllabus: 'Ementa 1',
                bibliography: 'SILVA, Joao. Referência 1. 2020.',
                modality: 'Presencial',
                learningAssessment: 'Provas',
            });

        const createSecondResponse = await supertest(app)
            .post('/api/components')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${token}`)
            .send({
                code: 'ATA002',
                name: 'Disciplina ATA 2',
                department: 'Departamento Teste',
                program: 'Programa Teste 2',
                semester: '2026.1',
                prerequeriments: 'Nenhum',
                methodology: 'Aulas expositivas',
                objective: 'Objetivo 2',
                syllabus: 'Ementa 2',
                bibliography: 'SOUZA, Maria. Referência 2. 2021.',
                modality: 'Presencial',
                learningAssessment: 'Seminários',
            });

        expect(createFirstResponse.statusCode).toBe(201);
        expect(createSecondResponse.statusCode).toBe(201);

        const firstComponentResponse = await supertest(app)
            .get('/api/components/ATA001')
            .set('Authorization', `Bearer ${token}`);

        const secondComponentResponse = await supertest(app)
            .get('/api/components/ATA002')
            .set('Authorization', `Bearer ${token}`);

        expect(firstComponentResponse.statusCode).toBe(200);
        expect(secondComponentResponse.statusCode).toBe(200);

        const firstApproveResponse = await supertest(app)
            .post(`/api/component-drafts/${firstComponentResponse.body.draft.id}/approve`)
            .set('Authorization', `Bearer ${token}`)
            .send({ password: 'test123' });

        expect(firstApproveResponse.statusCode).toBe(200);

        const secondApproveResponse = await supertest(app)
            .post(`/api/component-drafts/${secondComponentResponse.body.draft.id}/approve`)
            .set('Authorization', `Bearer ${token}`)
            .send({ password: 'test123' });

        expect(secondApproveResponse.statusCode).toBe(200);

        const [ firstPublished, secondPublished ] = await Promise.all([
            supertest(app).get('/api/components/ATA001').set('Authorization', `Bearer ${token}`),
            supertest(app).get('/api/components/ATA002').set('Authorization', `Bearer ${token}`),
        ]);
        const firstAgreement = firstPublished.body.logs.find((log: { type: string }) => log.type === 'approval').agreementNumber as string;
        const secondAgreement = secondPublished.body.logs.find((log: { type: string }) => log.type === 'approval').agreementNumber as string;
        const firstSequence = Number(firstAgreement.split('-').at(-1));
        const secondSequence = Number(secondAgreement.split('-').at(-1));

        expect(firstAgreement).toMatch(/^ATA-\d{4}-\d{3}$/);
        expect(secondAgreement).toMatch(/^ATA-\d{4}-\d{3}$/);
        expect(secondSequence).toBe(firstSequence + 1);
    });
});
