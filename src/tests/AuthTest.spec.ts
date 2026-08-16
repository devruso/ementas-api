import { UserController } from '../controllers/UserController';
import { AuthController } from '../controllers/AuthController';
import { UserInviteService } from '../services/UserInviteService';
import { generatePasswordResetToken } from '../helpers/passwordReset';
import { getCustomRepository } from 'typeorm';
import { verify } from 'jsonwebtoken';
import crypto from 'crypto';
import connection from './connection';
import { UserRepository } from '../repositories/UserRepository';
import { ApiErrorCode } from '../errors/ApiErrorCode';

jest.mock('../middlewares/Mailer', () => ({
    __esModule: true,
    default: {
        execute: jest.fn().mockResolvedValue({ deliveryMode: 'mock', fallbackReason: 'jest' }),
    },
}));
/* eslint-disable */
const MockExpressRequest = require('mock-express-request');
const MockExpressResponse = require('mock-express-response');
/* eslint-enable */

beforeAll(async ()=>{
    await connection.create();
});
  
afterAll(async ()=>{
    await connection.close();
});
beforeEach(async() => {
    const inviteToken = new UserInviteService().generateUserInvite();
    const userController = new UserController();
    const req = new MockExpressRequest({
        method:'POST',
        headers: {
            'Content-Type':'application/json',
        },
        params: {
            inviteToken,
        },
        body:{
            'name': 'Test',
            'email': 'test@ufba.br',
            'password':'test123'
        }
    });
    const res = new MockExpressResponse();
    await userController.create(req, res);
});
afterEach(async () => {
    await connection.clear();
});
describe('Login user', ()=>{
    it('should be able to login', async ()=>{
        const authController = new AuthController();
        const req = new MockExpressRequest({
            method:'POST',
            headers: {
                'Content-Type':'application/json',
            },
            body:{
                'email': 'test@ufba.br',
                'password':'test123'
            }
        });
        const res = new MockExpressResponse();
        await authController.login(req, res);
        expect(res.statusCode).toBe(201);
        
    });
    it('should not be able to login user with incorrect email and/or password', async ()=>{
        const authController = new AuthController();
        const req = new MockExpressRequest({
            method:'POST',
            headers: {
                'Content-Type':'application/json',
            },
            body:{
                'email': 'invalid-user@ufba.br',
                'password':'test123'
            }
        });
        const res = new MockExpressResponse();
        await expect(authController.login(req, res)).rejects.toMatchObject({
            statusCode: 401,
            code: ApiErrorCode.AUTH_INVALID_CREDENTIALS,
        });
    });
    it('should not be able to login user with incorrect passord and/or email', async ()=>{
        const authController = new AuthController();
        const req = new MockExpressRequest({
            method:'POST',
            headers: {
                'Content-Type':'application/json',
            },
            body:{
                'email': 'invalid-user@ufba.br',
                'password':'123test'
            }
        });
        const res = new MockExpressResponse();
        await expect(authController.login(req, res)).rejects.toMatchObject({
            statusCode: 401,
            code: ApiErrorCode.AUTH_INVALID_CREDENTIALS,
        });
    });
    it('should not be able to login user without email', async ()=>{
        const authController = new AuthController();
        const req = new MockExpressRequest({
            method:'POST',
            headers: {
                'Content-Type':'application/json',
            },
            body:{
                'password':'test123'
            }
        });
        const res = new MockExpressResponse();
        await expect(authController.login(req, res)).rejects.toHaveProperty('statusCode', 400);
    });
    it('should not be able to login user without password', async ()=>{
        const authController = new AuthController();
        const req = new MockExpressRequest({
            method:'POST',
            headers: {
                'Content-Type':'application/json',
            },
            body:{
                'email': 'test@ufba.br'
            }
        });
        const res = new MockExpressResponse();
        await expect(authController.login(req, res)).rejects.toHaveProperty('statusCode', 400);
    });
    it('should not be able to login user with empty body', async ()=>{
        const authController = new AuthController();
        const req = new MockExpressRequest({
            method:'POST',
            headers: {
                'Content-Type':'application/json',
            },
            body:{}
        });
        const res = new MockExpressResponse();
        await expect(authController.login(req, res)).rejects.toHaveProperty('statusCode', 400);
    });

    it('should not be able to login with non-institutional email domain', async ()=>{
        const authController = new AuthController();
        const req = new MockExpressRequest({
            method:'POST',
            headers: {
                'Content-Type':'application/json',
            },
            body:{
                'email': 'test@gmail.com',
                'password':'test123'
            }
        });
        const res = new MockExpressResponse();
        await expect(authController.login(req, res)).rejects.toHaveProperty('statusCode', 400);
    });

    it('should ignore soft-deleted users when duplicated email exists', async () => {
        const userRepository = getCustomRepository(UserRepository);
        const deletedPasswordHash = crypto.createHmac('sha256', 'Deleted123!').digest('hex');
        const activePasswordHash = crypto.createHmac('sha256', 'Active123!').digest('hex');

        await userRepository
            .createQueryBuilder()
            .update('users')
            .set({ isDeleted: true, isUserActive: false, password: deletedPasswordHash })
            .where('email = :email', { email: 'test@ufba.br' })
            .execute();

        const activeUser = await userRepository.save(userRepository.create({
            name: 'Active Test',
            email: 'test@ufba.br',
            password: activePasswordHash,
        }));

        const authController = new AuthController();
        const req = new MockExpressRequest({
            method:'POST',
            headers: {
                'Content-Type':'application/json',
            },
            body:{
                'email': 'test@ufba.br',
                'password':'Active123!'
            }
        });
        const res = new MockExpressResponse();

        await authController.login(req, res);

        const session = res._getJSON();
        const payload = verify(session.token, String(process.env.JWT_SECRET)) as { id?: string };

        expect(res.statusCode).toBe(201);
        expect(payload.id).toBe(activeUser.id);
    });
});

describe('Reset password user', ()=>{
    it('should be able to reset user password', async ()=>{
        const authController = new AuthController();
        const req = new MockExpressRequest({
            method:'POST',
            headers: {
                'Content-Type':'application/json',
            },
            body:{
                'email': 'test@ufba.br',
            }
        });
        const res = new MockExpressResponse();
        await authController.resetPassword(req, res);
        expect(res.statusCode).toBe(201);
      
    });
    it('should return success even when email does not exist', async ()=>{
        const authController = new AuthController();
        const req = new MockExpressRequest({
            method:'POST',
            headers: {
                'Content-Type':'application/json',
            },
            body:{
                'email': 'invalid-user@ufba.br',
            }
        });
        const res = new MockExpressResponse();
        await authController.resetPassword(req, res);
        expect(res.statusCode).toBe(201);
    });

    it('should not be able to reset password with non-institutional email domain', async ()=>{
        const authController = new AuthController();
        const req = new MockExpressRequest({
            method:'POST',
            headers: {
                'Content-Type':'application/json',
            },
            body:{
                'email': 'test@gmail.com',
            }
        });
        const res = new MockExpressResponse();
        await expect(authController.resetPassword(req, res)).rejects.toHaveProperty('statusCode', 400);
    });

    it('should be able to confirm password reset with token', async ()=>{
        const authController = new AuthController();
        const token = generatePasswordResetToken('test@ufba.br');
        const req = new MockExpressRequest({
            method:'POST',
            headers: {
                'Content-Type':'application/json',
            },
            body:{
                token,
                password:'Newpass123!'
            }
        });
        const res = new MockExpressResponse();

        await authController.confirmResetPassword(req, res);

        expect(res.statusCode).toBe(200);

        const loginController = new AuthController();
        const loginReq = new MockExpressRequest({
            method:'POST',
            headers: {
                'Content-Type':'application/json',
            },
            body:{
                'email': 'test@ufba.br',
                'password':'Newpass123!'
            }
        });
        const loginRes = new MockExpressResponse();

        await loginController.login(loginReq, loginRes);

        expect(loginRes.statusCode).toBe(201);
    });

    it('should update only the active user when confirming duplicated email reset', async () => {
        const userRepository = getCustomRepository(UserRepository);

        await userRepository
            .createQueryBuilder()
            .update('users')
            .set({
                isDeleted: true,
                isUserActive: false,
                password: crypto.createHmac('sha256', 'Deleted123!').digest('hex'),
            })
            .where('email = :email', { email: 'test@ufba.br' })
            .execute();

        const activeUser = await userRepository.save(userRepository.create({
            name: 'Active Reset',
            email: 'test@ufba.br',
            password: crypto.createHmac('sha256', 'Active123!').digest('hex'),
        }));

        const authController = new AuthController();
        const token = generatePasswordResetToken('test@ufba.br');
        const req = new MockExpressRequest({
            method:'POST',
            headers: {
                'Content-Type':'application/json',
            },
            body:{
                token,
                password:'Newpass123!'
            }
        });
        const res = new MockExpressResponse();

        await authController.confirmResetPassword(req, res);

        const loginReq = new MockExpressRequest({
            method:'POST',
            headers: {
                'Content-Type':'application/json',
            },
            body:{
                'email': 'test@ufba.br',
                'password':'Newpass123!'
            }
        });
        const loginRes = new MockExpressResponse();

        await authController.login(loginReq, loginRes);

        const session = loginRes._getJSON();
        const payload = verify(session.token, String(process.env.JWT_SECRET)) as { id?: string };

        expect(loginRes.statusCode).toBe(201);
        expect(payload.id).toBe(activeUser.id);
    });
});
