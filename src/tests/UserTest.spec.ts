import { UserController } from '../controllers/UserController';
import { UserInviteService } from '../services/UserInviteService';
import { UserService } from '../services/UserService';
import { getCustomRepository } from 'typeorm';
import { UserRepository } from '../repositories/UserRepository';
import { UserRole } from '../interfaces/UserRole';
import connection from './connection';
import crypto from 'crypto';

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

beforeEach(async () => {
    await connection.clear();
});

const getInviteToken = () => new UserInviteService().generateUserInvite();

describe('Create new user', ()=>{
    it('should be able to create new user', async ()=>{
        const inviteToken = getInviteToken();
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
        const userController = new UserController();
        await userController.create(req, res);
        expect(res.statusCode).toBe(201);
        
    });
    it('should not be able to create duplicate user', async ()=>{
        const inviteToken = getInviteToken();
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
        const userController = new UserController();
        await userController.create(req, res);
        await expect(userController.create(req, res)).rejects.toHaveProperty('statusCode', 400);
      
    });
    it('should not be able to create new user without email', async ()=>{
        const userController = new UserController();
        const inviteToken = getInviteToken();
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
                'password':'test123'
            }
        });
        const res = new MockExpressResponse();
        await expect(userController.create(req, res)).rejects.toHaveProperty('statusCode', 400);
    });
    it('should not be able to create new user without password', async ()=>{
        const userController = new UserController();
        const inviteToken = getInviteToken();
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
                'email': 'test@ufba.br'
            }
        });
        const res = new MockExpressResponse();
        await expect(userController.create(req, res)).rejects.toHaveProperty('statusCode', 400);
    });
    it('should not be able to create new user without name', async ()=>{
        const userController = new UserController();
        const inviteToken = getInviteToken();
        const req = new MockExpressRequest({
            method:'POST',
            headers: {
                'Content-Type':'application/json',
            },
            params: {
                inviteToken,
            },
            body:{
                'email': 'test@ufba.br',
                'password':'test123'
            }
        });
        const res = new MockExpressResponse();
        await expect(userController.create(req, res)).rejects.toHaveProperty('statusCode', 400);
    });
    it('should not be able to create new user with empty body', async ()=>{
        const userController = new UserController();
        const inviteToken = getInviteToken();
        const req = new MockExpressRequest({
            method:'POST',
            headers: {
                'Content-Type':'application/json',
            },
            params: {
                inviteToken,
            },
            body:{}
        });
        const res = new MockExpressResponse();
        await expect(userController.create(req, res)).rejects.toHaveProperty('statusCode', 400);
    });

    it('should not be able to create user with non-institutional email domain', async ()=>{
        const inviteToken = getInviteToken();
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
                'email': 'test@gmail.com',
                'password':'test123'
            }
        });
        const res = new MockExpressResponse();
        const userController = new UserController();
        await expect(userController.create(req, res)).rejects.toHaveProperty('statusCode', 400);
    });
});

describe('Create teacher by admin', () => {
    it('should be able to create teacher by admin', async () => {
        const userService = new UserService();
        const userRepository = getCustomRepository(UserRepository);
        const adminUser = await userRepository.save(userRepository.create({
            name: 'Admin User',
            email: 'admin@ufba.br',
            password: crypto.createHmac('sha256', 'Admin123!').digest('hex'),
            role: UserRole.ADMIN,
        }));

        const result = await userService.createTeacherByAdmin(
            adminUser.id,
            'Professor Claudio',
            'claudio@ufba.br',
            false
        );

        expect(result).toHaveProperty('temporaryPassword');
        expect(result).toHaveProperty('passwordSetupLink');
        expect(result).toMatchObject({
            name: 'Professor Claudio',
            email: 'claudio@ufba.br',
        });
        expect(result.emailDeliveryStatus).toBe('disabled');
    });

    it('should report mocked email delivery when admin requests credential email', async () => {
        const userService = new UserService();
        const userRepository = getCustomRepository(UserRepository);
        const adminUser = await userRepository.save(userRepository.create({
            name: 'Admin User',
            email: 'admin@ufba.br',
            password: crypto.createHmac('sha256', 'Admin123!').digest('hex'),
            role: UserRole.ADMIN,
        }));

        const result = await userService.createTeacherByAdmin(
            adminUser.id,
            'Professor Marina',
            'marina@ufba.br',
            true
        );

        expect(result.emailDeliveryStatus).toBe('mock');
        expect(result.temporaryPassword).toBeTruthy();
    });

    it('should generate invite link and report mocked email delivery', async () => {
        const userService = new UserService();
        const userRepository = getCustomRepository(UserRepository);
        const adminUser = await userRepository.save(userRepository.create({
            name: 'Admin User',
            email: 'admin@ufba.br',
            password: crypto.createHmac('sha256', 'Admin123!').digest('hex'),
            role: UserRole.ADMIN,
        }));

        const result = await userService.sendInviteByEmail(
            adminUser.id,
            'convite@ufba.br',
            'https://ementas.app.ic.ufba.com.br'
        );

        expect(result.email).toBe('convite@ufba.br');
        expect(result.inviteLink).toContain('/i/');
        expect(result.directInviteLink).toContain('/cadastrar/');
        expect(result.inviteShortCode).toBeTruthy();
        expect(result.emailDeliveryStatus).toBe('mock');
    });

    it('should not be able to create teacher by non-admin', async () => {
        const userService = new UserService();
        const userRepository = getCustomRepository(UserRepository);
        const teacherUser = await userRepository.save(userRepository.create({
            name: 'Teacher User',
            email: 'teacher@ufba.br',
            password: crypto.createHmac('sha256', 'Teacher123!').digest('hex'),
            role: UserRole.TEACHER,
        }));

        await expect(
            userService.createTeacherByAdmin(
                teacherUser.id,
                'Professor Ivan',
                'ivan@ufba.br',
                false
            )
        ).rejects.toHaveProperty('statusCode', 401);
    });
});