import supertest from 'supertest';
import { getCustomRepository } from 'typeorm';

import { UserController } from '../controllers/UserController';
import { UserInviteService } from '../services/UserInviteService';
import { UserRepository } from '../repositories/UserRepository';
import { UserRole } from '../interfaces/UserRole';
import { ApiErrorCode } from '../errors/ApiErrorCode';
import connection from './connection';

/* eslint-disable */
const app = require('../app').app;
const MockExpressRequest = require('mock-express-request');
const MockExpressResponse = require('mock-express-response');
/* eslint-enable */

const createInstitutionalUserAndToken = async (
    email: string,
    role: UserRole = UserRole.TEACHER
) => {
    const inviteToken = new UserInviteService().generateUserInvite();
    const userController = new UserController();
    const req = new MockExpressRequest({
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        params: {
            inviteToken,
        },
        body: {
            name: 'UFBA User',
            email,
            password: 'Test123!'
        },
    });
    const res = new MockExpressResponse();

    await userController.create(req, res);

    const createdUserId = res._getJSON().id;

    if (role !== UserRole.TEACHER) {
        const userRepository = getCustomRepository(UserRepository);
        await userRepository.update(createdUserId, { role });
    }

    const loginResponse = await supertest(app)
        .post('/api/auth/login')
        .send({
            email,
            password: 'Test123!',
        });

    return {
        id: createdUserId,
        token: loginResponse.body.token,
    };
};

const institutionalEmailError = {
    code: ApiErrorCode.AUTH_INSTITUTIONAL_EMAIL_REQUIRED,
    message: 'Use um e-mail institucional da UFBA.',
    reason: 'O acesso é restrito a endereços institucionais autorizados.',
    recovery: 'Informe seu endereço terminado em @ufba.br.',
};

describe('Institutional email HTTP contract', () => {
    beforeAll(async () => {
        await connection.create();
    });

    afterAll(async () => {
        await connection.close();
    });

    beforeEach(async () => {
        await connection.clear();
    });

    it('should return standardized error for login with non-institutional domain', async () => {
        const response = await supertest(app)
            .post('/api/auth/login')
            .send({
                email: 'user@gmail.com',
                password: 'Test123!',
            });

        expect(response.statusCode).toBe(400);
        expect(response.body).toEqual(institutionalEmailError);
    });

    it('should return standardized error for reset-password with non-institutional domain', async () => {
        const response = await supertest(app)
            .post('/api/auth/reset-password')
            .send({
                email: 'user@gmail.com',
            });

        expect(response.statusCode).toBe(400);
        expect(response.body).toEqual(institutionalEmailError);
    });

    it('should return standardized error for registration with non-institutional domain', async () => {
        const inviteToken = new UserInviteService().generateUserInvite();

        const response = await supertest(app)
            .post(`/api/users/${inviteToken}`)
            .send({
                name: 'External User',
                email: 'external@gmail.com',
                password: 'Test123!',
            });

        expect(response.statusCode).toBe(400);
        expect(response.body).toEqual(institutionalEmailError);
    });

    it('should return standardized error for update email with non-institutional domain', async () => {
        const teacher = await createInstitutionalUserAndToken('teacher@ufba.br');

        const response = await supertest(app)
            .put('/api/users/update/email')
            .set('Authorization', `Bearer ${teacher.token}`)
            .send({
                email: 'external@gmail.com',
            });

        expect(response.statusCode).toBe(400);
        expect(response.body).toEqual(institutionalEmailError);
    });
});
