import { Request, Response } from 'express';
import {
    CreateUserRequestDto,
    SendInviteByEmailRequestDto,
    UpdateUserRequestDto,
    UpdateUserRoleRequestDto,
    UpdateUserSignatureRequestDto,
} from '../dtos/user';

import { UserService } from '../services/UserService';
import { UserInviteService } from '../services/UserInviteService';
import { paginate } from '../helpers/paginate';

class UserController {
    async getUsers(request: Request, response: Response) {
        const authenticatedUserId = request.headers
            .authenticatedUserId as string;

        const userService = new UserService();

        const search = String(request.query.search ?? '').trim() || undefined;
        const sortBy = String(request.query.sortBy ?? '').trim() || undefined;
        const sortOrder = String(request.query.sortOrder ?? 'DESC').toUpperCase() === 'ASC'
            ? 'ASC'
            : 'DESC';
        const page = parseInt(String(request.query.page)) || 0;
        const limit = parseInt(String(request.query.limit)) || 10;

        const users = await userService.getUsers({
            search,
            sortBy,
            sortOrder,
        });

        return response.status(200).json(paginate(users, { page, limit, search, sortBy, sortOrder }));
    }

    async getUserById(request: Request, response: Response) {
        const { id } = request.params;

        const userService = new UserService();
        const user = await userService.getUserByID(id);

        return response.status(200).json(user);
    }

    async create(request: Request, response: Response) {
        const { inviteToken } = request.params;

        if(!inviteToken) {
            return response.status(400).send({ message: 'A registration invite is necessary.' });
        }

        //Valida o token de convite
        new UserInviteService().validateUserInvite(inviteToken);

        const { name, email, password } = request.body as CreateUserRequestDto;

        const userService = new UserService();
        const user = await userService.create(name, email, password);

        return response.status(201).send({ id: user.id });
    }

    async createTeacherByAdmin(request: Request, response: Response) {
        const authenticatedUserId = request.headers.authenticatedUserId as string;
        const { name, email, sendCredentialsByEmail } = request.body as {
            name: string;
            email: string;
            sendCredentialsByEmail?: boolean;
        };

        const userService = new UserService();
        const createdTeacher = await userService.createTeacherByAdmin(
            authenticatedUserId,
            name,
            email,
            sendCredentialsByEmail ?? true
        );

        return response.status(201).json(createdTeacher);
    }

    async sendInviteByEmail(request: Request, response: Response) {
        const authenticatedUserId = request.headers.authenticatedUserId as string;
        const { email, registrationBaseUrl } = request.body as SendInviteByEmailRequestDto;

        const userService = new UserService();
        const inviteDelivery = await userService.sendInviteByEmail(
            authenticatedUserId,
            email,
            registrationBaseUrl
        );

        return response.status(201).json(inviteDelivery);
    }

    async updateEmail(request: Request, response: Response) {
        const authenticatedUserId = request.headers.authenticatedUserId as string;
        const { email } = request.body as UpdateUserRequestDto;

        const userService = new UserService();
        const user = await userService.updateEmail(authenticatedUserId, email);

        return response.status(200).json(user);
    }

    async updatePassword(request: Request, response: Response) {
        const authenticatedUserId = request.headers.authenticatedUserId as string;
        const { password } = request.body as UpdateUserRequestDto;

        const userService = new UserService();
        const user = await userService.updatePassword(authenticatedUserId, password);

        return response.status(200).json(user);
    }

    async updateSignature(request: Request, response: Response) {
        const authenticatedUserId = request.headers.authenticatedUserId as string;
        const { signature } = request.body as UpdateUserSignatureRequestDto;

        const userService = new UserService();
        const user = await userService.updateSignature(authenticatedUserId, signature);

        return response.status(200).json(user);
    }

    async updateSignatureFile(request: Request, response: Response) {
        const authenticatedUserId = request.headers.authenticatedUserId as string;
        const signature = typeof request.body?.signature === 'string'
            ? request.body.signature
            : undefined;

        const userService = new UserService();
        const user = await userService.updateSignatureFile(authenticatedUserId, request.file, signature);

        return response.status(200).json(user);
    }

    async getSignatureFilePreview(request: Request, response: Response) {
        const authenticatedUserId = request.headers.authenticatedUserId as string;

        const userService = new UserService();
        const signaturePreview = await userService.getSignatureFilePreview(authenticatedUserId);

        response.setHeader('Content-Type', signaturePreview.contentType);
        response.setHeader('Content-Disposition', 'inline; filename="assinatura-atual"');

        return response.status(200).send(signaturePreview.content);
    }

    async updateRole(request: Request, response: Response) {
        const authenticatedUserId = request.headers.authenticatedUserId as string;
        const { id } = request.params;
        const { role } = request.body as UpdateUserRoleRequestDto;

        const userService = new UserService();
        const user = await userService.updateUserRole(authenticatedUserId, id, role);

        return response.status(200).json(user);
    }

    async delete(request: Request, response: Response) {
        const authenticatedUserId = request.headers.authenticatedUserId as string;
        const { id } = request.params;

        const userService = new UserService();
        await userService.delete(authenticatedUserId, id);

        return response.status(200).json({ message: 'User has been deleted!' });
    }

}

export { UserController };
