import * as crypto from 'crypto';
import { JwtPayload, sign, verify } from 'jsonwebtoken';
import { Repository, getCustomRepository } from 'typeorm';

import { User } from '../entities/User';
import { UserRepository } from '../repositories/UserRepository';
import { AppError } from './../errors/AppError';
import Mailer from '../middlewares/Mailer';
import { assertUfbaInstitutionalEmail, normalizeEmail } from '../helpers/institutionalEmail';
import { buildResetPasswordEmailTemplate } from '../helpers/emailTemplates';
import { buildPasswordResetLink, generatePasswordResetToken, resolvePasswordResetEmailFromToken } from '../helpers/passwordReset';

type CurrentUserResponse = Pick<
    User,
    | 'id'
    | 'name'
    | 'email'
    | 'role'
    | 'signatureUpdatedAt'
    | 'signatureFileKey'
    | 'signatureFileProvider'
    | 'signatureFileContentType'
    | 'signatureFileSize'
    | 'signatureFileHash'
    | 'createdAt'
    | 'updatedAt'
> & {
    hasSignatureConfigured: boolean;
    hasSignatureFileConfigured: boolean;
};

class AuthService {
    private userRepository : Repository<User>;

    constructor() {
        this.userRepository = getCustomRepository(UserRepository);
    }

    private getAccessTokenDeadline() {
        return Number(process.env.JWT_DEADLINE || 3600);
    }

    private getRefreshTokenDeadline() {
        return Number(process.env.JWT_REFRESH_DEADLINE || 86400);
    }

    private getRefreshSecret() {
        return String(process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    }

    private buildAccessToken(user: Pick<User, 'id' | 'name' | 'email'>) {
        return sign(
            { id: user.id, name: user.name, email: user.email, tokenType: 'access' },
            String(process.env.JWT_SECRET),
            { expiresIn: this.getAccessTokenDeadline() }
        );
    }

    private buildRefreshToken(user: Pick<User, 'id' | 'email'>) {
        return sign(
            { id: user.id, email: user.email, tokenType: 'refresh' },
            this.getRefreshSecret(),
            { expiresIn: this.getRefreshTokenDeadline() }
        );
    }

    private buildAuthResponse(user: Pick<User, 'id' | 'name' | 'email'>) {
        const accessToken = this.buildAccessToken(user);
        const refreshToken = this.buildRefreshToken(user);

        return {
            token: accessToken,
            accessToken,
            refreshToken,
            expiresIn: this.getAccessTokenDeadline(),
            refreshExpiresIn: this.getRefreshTokenDeadline(),
        };
    }

    async login(email: string, password: string) {
        const normalizedEmail = typeof email === 'string' ? normalizeEmail(email) : '';

        if (!normalizedEmail || password == undefined) {
            throw new AppError('Username or password missing. Please try again!', 400);
        }

        if (!assertUfbaInstitutionalEmail(normalizedEmail)) {
            throw new AppError('Only UFBA institutional email addresses are allowed.', 400);
        }

        const user = await this.userRepository.findOne({
            where: {
                email: normalizedEmail,
                password: crypto.createHmac('sha256', password).digest('hex')
            },
        });

        if (!user) {
            throw new AppError('Incorrect username and/or password. Please try again!', 400);
        }

        const { id, name } = user;

        return this.buildAuthResponse({ id, name, email: normalizedEmail });
    }

    async refreshSession(refreshToken: string) {
        if (!refreshToken) {
            throw new AppError('Refresh token missing.', 401);
        }

        let payload: JwtPayload;
        let tokenType: string | undefined;

        try {
            payload = verify(refreshToken, this.getRefreshSecret()) as JwtPayload;
            tokenType = typeof payload.tokenType === 'string' ? payload.tokenType : undefined;
        } catch (error) {
            try {
                payload = verify(refreshToken, String(process.env.JWT_SECRET)) as JwtPayload;
                tokenType = typeof payload.tokenType === 'string' ? payload.tokenType : 'access';
            } catch {
                throw new AppError('Refresh token invalid or expired.', 401);
            }
        }

        const isAcceptedTokenType = tokenType === 'refresh' || tokenType === 'access' || tokenType === undefined;

        if (!isAcceptedTokenType || typeof payload.id !== 'string') {
            throw new AppError('Refresh token invalid or expired.', 401);
        }

        const user = await this.userRepository.findOne({ id: payload.id });

        if (!user) {
            throw new AppError('User not found.', 401);
        }

        return this.buildAuthResponse({ id: user.id, name: user.name, email: user.email });
    }

    async getCurrentUser(userId: string): Promise<CurrentUserResponse> {
        const user = await this.userRepository.findOne({ id: userId });

        if (!user) {
            throw new AppError('User not found.', 401);
        }

        return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            signatureUpdatedAt: user.signatureUpdatedAt,
            signatureFileKey: user.signatureFileKey,
            signatureFileProvider: user.signatureFileProvider,
            signatureFileContentType: user.signatureFileContentType,
            signatureFileSize: user.signatureFileSize,
            signatureFileHash: user.signatureFileHash,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            hasSignatureConfigured: Boolean(user.signatureHash),
            hasSignatureFileConfigured: Boolean(
                user.signatureFileKey &&
                user.signatureFileContentType &&
                /^image\//i.test(user.signatureFileContentType)
            ),
        };
    }


    async resetPassword(email: string) {
        const normalizedEmail = typeof email === 'string' ? normalizeEmail(email) : '';

        if (!assertUfbaInstitutionalEmail(normalizedEmail)) {
            throw new AppError('Only UFBA institutional email addresses are allowed.', 400);
        }

        const user = await this.userRepository.findOne({ email: normalizedEmail });

        if (!user) {
            return;
        }

        try {
            const resetPasswordToken = generatePasswordResetToken(normalizedEmail);
            const resetPasswordLink = buildPasswordResetLink(resetPasswordToken);
            const resetPasswordEmail = buildResetPasswordEmailTemplate(resetPasswordLink);

            await Mailer.execute(normalizedEmail, 'Nova Senha - EMENTAS', resetPasswordEmail);
        }
        catch (err) {
            console.log(err);
            throw new AppError('Nao foi possivel enviar o e-mail de recuperacao de senha.', 400);
        }
    }

    async confirmResetPassword(token: string, password: string) {
        const normalizedToken = typeof token === 'string' ? token.trim() : '';
        const normalizedPassword = typeof password === 'string' ? password.trim() : '';

        if (!normalizedToken || !normalizedPassword) {
            throw new AppError('Token and password are required.', 400);
        }

        const email = resolvePasswordResetEmailFromToken(normalizedToken);

        if (!assertUfbaInstitutionalEmail(email)) {
            throw new AppError('Only UFBA institutional email addresses are allowed.', 400);
        }

        const user = await this.userRepository.findOne({
            where: { email, isDeleted: false },
        });

        if (!user) {
            throw new AppError('This password reset link is invalid or expired.', 401);
        }

        const passwordHash = crypto.createHmac('sha256', normalizedPassword).digest('hex');

        await this.userRepository.createQueryBuilder()
            .update(User)
            .set({ password: passwordHash })
            .where('email = :email', { email })
            .execute();

        return { email };
    }

    generateUserInvite() {
        const generatedHash = Math.random().toString(36).substring(2);
        const token = sign({ generatedHash }, String(process.env.JWT_SECRET), { expiresIn: 86400 });

        return token;
    }

}

export { AuthService };


