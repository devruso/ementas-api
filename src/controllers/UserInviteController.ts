import { Request, Response } from 'express';
import { UserInviteService } from '../services/UserInviteService';

class UserInviteController {
    generateUserInvite(request: Request, response: Response) {
        const userInviteService = new UserInviteService();
        const token = userInviteService.generateUserInvite();

        return response.status(201).json({ link: `/api/invite/${token}`, token, expiresInSeconds: 86400 });
    }

    validateUserInvite(request: Request, response: Response) {
        const { inviteToken } = request.params;
        const userInviteService = new UserInviteService();

        userInviteService.validateUserInvite(inviteToken);

        return response.status(200).json({ tokenIsValid: true });
    }

    async resolveUserInviteShortCode(request: Request, response: Response) {
        const { shortCode } = request.params;
        const userInviteService = new UserInviteService();
        const inviteToken = await userInviteService.resolveShortInvite(shortCode);

        return response.status(200).json({ inviteToken });
    }

}

export { UserInviteController };
