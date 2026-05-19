import supertest from 'supertest';
import { getCustomRepository } from 'typeorm';

import { UserController } from '../controllers/UserController';
import { UserInviteService } from '../services/UserInviteService';
import { UserRepository } from '../repositories/UserRepository';
import connection from './connection';

/* eslint-disable */
const app = require('../app').app;
const MockExpressRequest = require('mock-express-request');
const MockExpressResponse = require('mock-express-response');
/* eslint-enable */

type CreatedUser = {
    id: string;
    token: string;
    email: string;
};

const createUserAndLogin = async (name: string, email: string, password: string): Promise<CreatedUser> => {
    const inviteToken = new UserInviteService().generateUserInvite();
    const userController = new UserController();
    const req = new MockExpressRequest({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        params: { inviteToken },
        body: { name, email, password },
    });
    const res = new MockExpressResponse();

    await userController.create(req, res);

    const loginResponse = await supertest(app)
        .post('/api/auth/login')
        .send({ email, password });

    return {
        id: res._getJSON().id,
        token: loginResponse.body.token,
        email,
    };
};

const promoteToAdmin = async (userId: string) => {
    const userRepository = getCustomRepository(UserRepository);

    await userRepository
        .createQueryBuilder()
        .update('users')
        .set({ role: 'admin' })
        .where('id = :id', { id: userId })
        .execute();
};

describe('Component public shares endpoints', () => {
    beforeAll(async () => {
        await connection.create();
    });

    afterAll(async () => {
        await connection.close();
    });

    afterEach(async () => {
        await connection.clear();
    });

    it('should list active shares with creator metadata', async () => {
        const admin = await createUserAndLogin('Admin Share', 'admin.share@ufba.br', 'Admin123!');
        await promoteToAdmin(admin.id);

        const createComponentResponse = await supertest(app)
            .post('/api/components')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${admin.token}`)
            .send({
                code: 'SHR101',
                name: 'Disciplina Share',
                department: 'DCC',
                program: 'Programa de teste',
                semester: '2026.1',
                prerequeriments: 'Nenhum',
                methodology: 'Aulas',
                objective: 'Validar listagem de shares',
                syllabus: 'Ementa',
                bibliography: 'Bibliografia',
                modality: 'Presencial',
                learningAssessment: 'Provas',
            });

        expect(createComponentResponse.statusCode).toBe(201);

        const createShareResponse = await supertest(app)
            .post(`/api/components/${createComponentResponse.body.id}/public-shares`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ expiresInHours: 24 });

        expect(createShareResponse.statusCode).toBe(201);

        const listSharesResponse = await supertest(app)
            .get(`/api/components/${createComponentResponse.body.id}/public-shares`)
            .set('Authorization', `Bearer ${admin.token}`);

        expect(listSharesResponse.statusCode).toBe(200);
        expect(Array.isArray(listSharesResponse.body.results)).toBe(true);
        expect(listSharesResponse.body.results.length).toBeGreaterThanOrEqual(1);
        expect(listSharesResponse.body.results[0]).toEqual(
            expect.objectContaining({
                id: expect.any(String),
                token: expect.any(String),
                publicLink: expect.stringContaining('/publico/disciplinas/'),
                createdByUser: expect.objectContaining({
                    id: admin.id,
                    name: 'Admin Share',
                    email: admin.email,
                }),
            })
        );
    });

    it('should revoke all active shares from a component', async () => {
        const admin = await createUserAndLogin('Admin Bulk', 'admin.bulk@ufba.br', 'Admin123!');
        await promoteToAdmin(admin.id);

        const createComponentResponse = await supertest(app)
            .post('/api/components')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${admin.token}`)
            .send({
                code: 'SHR201',
                name: 'Disciplina Bulk',
                department: 'DCC',
                program: 'Programa de teste',
                semester: '2026.1',
                prerequeriments: 'Nenhum',
                methodology: 'Aulas',
                objective: 'Validar revogacao em massa',
                syllabus: 'Ementa',
                bibliography: 'Bibliografia',
                modality: 'Presencial',
                learningAssessment: 'Provas',
            });

        expect(createComponentResponse.statusCode).toBe(201);

        const componentId = createComponentResponse.body.id;

        await supertest(app)
            .post(`/api/components/${componentId}/public-shares`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ expiresInHours: 24 });

        await supertest(app)
            .post(`/api/components/${componentId}/public-shares`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ expiresInHours: 48 });

        const revokeAllResponse = await supertest(app)
            .post(`/api/components/${componentId}/public-shares/revoke-all`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send();

        expect(revokeAllResponse.statusCode).toBe(200);
        expect(revokeAllResponse.body).toEqual({ revokedCount: 2 });

        const listAfterRevokeResponse = await supertest(app)
            .get(`/api/components/${componentId}/public-shares`)
            .set('Authorization', `Bearer ${admin.token}`);

        expect(listAfterRevokeResponse.statusCode).toBe(200);
        expect(listAfterRevokeResponse.body.results).toEqual([]);
    });

    it('should not allow non-admin user to revoke all active shares', async () => {
        const admin = await createUserAndLogin('Admin Owner', 'admin.owner@ufba.br', 'Admin123!');
        await promoteToAdmin(admin.id);

        const teacher = await createUserAndLogin('Teacher User', 'teacher.user@ufba.br', 'Teacher123!');

        const createComponentResponse = await supertest(app)
            .post('/api/components')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${admin.token}`)
            .send({
                code: 'SHR301',
                name: 'Disciplina Restrita',
                department: 'DCC',
                program: 'Programa de teste',
                semester: '2026.1',
                prerequeriments: 'Nenhum',
                methodology: 'Aulas',
                objective: 'Validar autorização no revoke-all',
                syllabus: 'Ementa',
                bibliography: 'Bibliografia',
                modality: 'Presencial',
                learningAssessment: 'Provas',
            });

        expect(createComponentResponse.statusCode).toBe(201);

        const componentId = createComponentResponse.body.id;

        const createShareResponse = await supertest(app)
            .post(`/api/components/${componentId}/public-shares`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ expiresInHours: 24 });

        expect(createShareResponse.statusCode).toBe(201);

        const unauthorizedRevokeAllResponse = await supertest(app)
            .post(`/api/components/${componentId}/public-shares/revoke-all`)
            .set('Authorization', `Bearer ${teacher.token}`)
            .send();

        expect(unauthorizedRevokeAllResponse.statusCode).toBe(401);
        expect(unauthorizedRevokeAllResponse.body.message).toBe('Only admin users can revoke all public shares.');
    });

    it('should sort active shares by expiresAt in ASC and DESC order', async () => {
        const admin = await createUserAndLogin('Admin Sort', 'admin.sort@ufba.br', 'Admin123!');
        await promoteToAdmin(admin.id);

        const createComponentResponse = await supertest(app)
            .post('/api/components')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${admin.token}`)
            .send({
                code: 'SHR401',
                name: 'Disciplina Ordenacao',
                department: 'DCC',
                program: 'Programa de teste',
                semester: '2026.1',
                prerequeriments: 'Nenhum',
                methodology: 'Aulas',
                objective: 'Validar ordenação ASC/DESC',
                syllabus: 'Ementa',
                bibliography: 'Bibliografia',
                modality: 'Presencial',
                learningAssessment: 'Provas',
            });

        expect(createComponentResponse.statusCode).toBe(201);
        const componentId = createComponentResponse.body.id;

        const shortShare = await supertest(app)
            .post(`/api/components/${componentId}/public-shares`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ expiresInHours: 24 });
        const longShare = await supertest(app)
            .post(`/api/components/${componentId}/public-shares`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ expiresInHours: 72 });

        expect(shortShare.statusCode).toBe(201);
        expect(longShare.statusCode).toBe(201);

        const ascResponse = await supertest(app)
            .get(`/api/components/${componentId}/public-shares`)
            .query({ sortBy: 'expiresAt', sortOrder: 'ASC', page: 0, limit: 10 })
            .set('Authorization', `Bearer ${admin.token}`);

        expect(ascResponse.statusCode).toBe(200);
        expect(ascResponse.body.results[0].id).toBe(shortShare.body.id);
        expect(ascResponse.body.results[1].id).toBe(longShare.body.id);

        const descResponse = await supertest(app)
            .get(`/api/components/${componentId}/public-shares`)
            .query({ sortBy: 'expiresAt', sortOrder: 'DESC', page: 0, limit: 10 })
            .set('Authorization', `Bearer ${admin.token}`);

        expect(descResponse.statusCode).toBe(200);
        expect(descResponse.body.results[0].id).toBe(longShare.body.id);
        expect(descResponse.body.results[1].id).toBe(shortShare.body.id);
    });
});