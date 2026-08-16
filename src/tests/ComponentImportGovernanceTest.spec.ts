import supertest from 'supertest';
import { getCustomRepository } from 'typeorm';

import { UserController } from '../controllers/UserController';
import { UserInviteService } from '../services/UserInviteService';
import { CrawlerService, ImportComponentsSummary } from '../services/CrawlerService';
import { UserRepository } from '../repositories/UserRepository';
import { ApiErrorCode } from '../errors/ApiErrorCode';
import connection from './connection';

/* eslint-disable */
const app = require('../app').app;
const MockExpressRequest = require('mock-express-request');
const MockExpressResponse = require('mock-express-response');
/* eslint-enable */

const defaultPassword = 'test123';

const createUserAndGetToken = async (
    name: string,
    email: string,
    role: 'teacher' | 'admin' | 'super_admin' = 'teacher'
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
            name,
            email,
            password: defaultPassword,
        },
    });
    const res = new MockExpressResponse();

    await userController.create(req, res);

    const createdUserId = res._getJSON().id;

    if (role !== 'teacher') {
        const userRepository = getCustomRepository(UserRepository);
        await userRepository
            .createQueryBuilder()
            .update('users')
            .set({ role })
            .where('id = :id', { id: createdUserId })
            .execute();
    }

    const loginResponse = await supertest(app)
        .post('/api/auth/login')
        .send({
            email,
            password: defaultPassword,
        });

    return {
        id: createdUserId,
        token: loginResponse.body.token,
    };
};

describe('Component import governance', () => {
    beforeAll(async () => {
        await connection.create();
    });

    afterAll(async () => {
        await connection.close();
    });

    beforeEach(async () => {
        await connection.clear();
        jest.restoreAllMocks();
    });

    it('should block SIGAA public import for non-admin users', async () => {
        const teacher = await createUserAndGetToken('Teacher', 'teacher-import@ufba.br', 'teacher');

        const response = await supertest(app)
            .post('/api/components/import/sigaa-public')
            .set('Authorization', `Bearer ${teacher.token}`)
            .send({
                sourceType: 'department',
                sourceId: '1114',
                academicLevel: 'graduacao',
            });

        expect(response.statusCode).toBe(403);
        expect(response.body).toMatchObject({
            code: ApiErrorCode.AUTH_FORBIDDEN,
            message: 'Você não tem permissão para esta operação.',
        });
    });

    it('should return SIGAA import summary for admin users', async () => {
        const admin = await createUserAndGetToken('Admin', 'admin-import@ufba.br', 'admin');
        const mockedSummary: ImportComponentsSummary = {
            source: 'sigaa-public',
            requested: 2,
            created: 1,
            skippedExisting: 1,
            failed: 0,
            failures: [],
            failureCategories: {},
        };

        const importSpy = jest
            .spyOn(CrawlerService.prototype, 'importComponentsFromSigaaPublic')
            .mockResolvedValue(mockedSummary);

        const response = await supertest(app)
            .post('/api/components/import/sigaa-public')
            .set('Authorization', `Bearer ${admin.token}`)
            .send({
                sourceType: 'department',
                sourceId: '1114',
                academicLevel: 'graduacao',
            });

        expect(response.statusCode).toBe(201);
        expect(response.body).toMatchObject({
            source: 'sigaa-public',
            requested: 2,
            created: 1,
            skippedExisting: 1,
            failed: 0,
            failures: [],
            parameters: {
                sourceType: 'department',
                sourceId: '1114',
                academicLevel: 'graduacao',
            },
        });
        expect(importSpy).toHaveBeenCalledWith(admin.id, 'department', '1114', 'graduacao', {
            reconcileExisting: true,
            enrichDetails: true,
            maxComponents: undefined,
            requestTimeoutMs: undefined,
        });
    });

    it('should return SIAC import summary for admin users', async () => {
        const admin = await createUserAndGetToken('Admin Siac', 'admin-siac-import@ufba.br', 'admin');
        const mockedSummary: ImportComponentsSummary = {
            source: 'siac',
            requested: 5,
            created: 3,
            skippedExisting: 2,
            failed: 0,
            failures: [],
            failureCategories: {},
        };

        const importSpy = jest
            .spyOn(CrawlerService.prototype, 'importComponentsFromSiac')
            .mockResolvedValue(mockedSummary);

        const response = await supertest(app)
            .post('/api/components/import')
            .set('Authorization', `Bearer ${admin.token}`)
            .send({
                cdCurso: '112140',
                nuPerCursoInicial: '20132',
            });

        expect(response.statusCode).toBe(201);
        expect(response.body).toMatchObject({
            source: 'siac',
            requested: 5,
            created: 3,
            skippedExisting: 2,
            failed: 0,
            failures: [],
            parameters: {
                cdCurso: '112140',
                nuPerCursoInicial: '20132',
            },
        });
        expect(importSpy).toHaveBeenCalledWith(admin.id, '112140', '20132');
    });
});
