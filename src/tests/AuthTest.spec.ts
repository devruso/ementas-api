import { UserController } from '../controllers/UserController';
import { AuthController } from '../controllers/AuthController';
import { UserInviteService } from '../services/UserInviteService';
import connection from './connection';

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
        await expect(authController.login(req, res)).rejects.toHaveProperty('statusCode', 400);
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
        await expect(authController.login(req, res)).rejects.toHaveProperty('statusCode', 400);
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
});