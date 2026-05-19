import supertest from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';

import { UserController } from '../controllers/UserController';
import { UserInviteService } from '../services/UserInviteService';
import connection from './connection';

/* eslint-disable */
const app = require('../app').app;
const MockExpressRequest = require('mock-express-request');
const MockExpressResponse = require('mock-express-response');
/* eslint-enable */

const createUserAndLogin = async () => {
    const inviteToken = new UserInviteService().generateUserInvite();
    const userController = new UserController();
    const req = new MockExpressRequest({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        params: { inviteToken },
        body: {
            name: 'Signature User',
            email: 'signature-user@ufba.br',
            password: 'test123',
        },
    });
    const res = new MockExpressResponse();

    await userController.create(req, res);

    const loginResponse = await supertest(app)
        .post('/api/auth/login')
        .send({ email: 'signature-user@ufba.br', password: 'test123' });

    return loginResponse.body.token as string;
};

describe('User signature upload flow', () => {
    let token = '';

    beforeAll(async () => {
        await connection.create();
    });

    afterAll(async () => {
        await connection.close();
    });

    afterEach(async () => {
        await connection.clear();
    });

    it('should update user signature metadata with multipart file upload', async () => {
        token = await createUserAndLogin();

        const uploadResponse = await supertest(app)
            .put('/api/users/update/signature/file')
            .set('Authorization', `Bearer ${token}`)
            .field('signature', 'Assina123!')
            .attach('signatureFile', Buffer.from('fake-signature-file'), {
                filename: 'assinatura.png',
                contentType: 'image/png',
            });

        expect(uploadResponse.statusCode).toBe(200);
        expect(uploadResponse.body.signatureUpdatedAt).toBeDefined();
        expect(uploadResponse.body.signatureHash).toBeDefined();
        expect(uploadResponse.body.signatureFileKey).toContain('signatures/');
        expect(uploadResponse.body.signatureFileProvider).toBe('local');
        expect(uploadResponse.body.signatureFileContentType).toBe('image/png');
        expect(uploadResponse.body.signatureFileSize).toBeGreaterThan(0);
        expect(uploadResponse.body.signatureFileHash).toBeDefined();
    });

    it('should reject upload without signature file', async () => {
        token = await createUserAndLogin();

        const uploadResponse = await supertest(app)
            .put('/api/users/update/signature/file')
            .set('Authorization', `Bearer ${token}`)
            .field('signature', 'Assina123!');

        expect(uploadResponse.statusCode).toBe(400);
        expect(uploadResponse.body.message).toBe('Nenhum arquivo de assinatura foi enviado.');
    });
});
