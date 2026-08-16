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
import { ApiErrorCode } from '../errors/ApiErrorCode';

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
            throw AppError.fromCode(ApiErrorCode.AUTH_CREDENTIALS_REQUIRED);
        }

        if (!assertUfbaInstitutionalEmail(normalizedEmail)) {
            throw AppError.fromCode(ApiErrorCode.AUTH_INSTITUTIONAL_EMAIL_REQUIRED);
        }

        const passwordHash = crypto.createHmac('sha256', password).digest('hex');
        const user = await this.userRepository.findOne({
            where: {
                email: normalizedEmail,
                password: passwordHash,
                isDeleted: false,
                isUserActive: true,
            },
        });

        if (!user) {
            throw AppError.fromCode(ApiErrorCode.AUTH_INVALID_CREDENTIALS);
        }

        const { id, name } = user;

        return this.buildAuthResponse({ id, name, email: normalizedEmail });
    }

    async refreshSession(refreshToken: string) {
        if (!refreshToken) {
            throw AppError.fromCode(ApiErrorCode.AUTH_SESSION_EXPIRED);
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
                throw AppError.fromCode(ApiErrorCode.AUTH_SESSION_EXPIRED);
            }
        }

        const isAcceptedTokenType = tokenType === 'refresh' || tokenType === 'access' || tokenType === undefined;

        if (!isAcceptedTokenType || typeof payload.id !== 'string') {
            throw AppError.fromCode(ApiErrorCode.AUTH_SESSION_EXPIRED);
        }

        const user = await this.userRepository.findOne({
            where: { id: payload.id, isDeleted: false, isUserActive: true },
        });

        if (!user) {
            throw AppError.fromCode(ApiErrorCode.AUTH_USER_UNAVAILABLE);
        }

        return this.buildAuthResponse({ id: user.id, name: user.name, email: user.email });
    }

    async getCurrentUser(userId: string): Promise<CurrentUserResponse> {
        const user = await this.userRepository.findOne({
            where: { id: userId, isDeleted: false, isUserActive: true },
        });

        if (!user) {
            throw AppError.fromCode(ApiErrorCode.AUTH_USER_UNAVAILABLE);
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
            throw AppError.fromCode(ApiErrorCode.AUTH_INSTITUTIONAL_EMAIL_REQUIRED);
        }

        const user = await this.userRepository.findOne({
            where: { email: normalizedEmail, isDeleted: false, isUserActive: true },
        });

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
            throw AppError.fromCode(ApiErrorCode.AUTH_PASSWORD_RESET_DELIVERY_FAILED);
        }
    }

    async confirmResetPassword(token: string, password: string) {
        const normalizedToken = typeof token === 'string' ? token.trim() : '';
        const normalizedPassword = typeof password === 'string' ? password.trim() : '';

        if (!normalizedToken || !normalizedPassword) {
            throw AppError.fromCode(ApiErrorCode.AUTH_PASSWORD_RESET_INPUT_REQUIRED);
        }

        const email = resolvePasswordResetEmailFromToken(normalizedToken);

        if (!assertUfbaInstitutionalEmail(email)) {
            throw AppError.fromCode(ApiErrorCode.AUTH_INSTITUTIONAL_EMAIL_REQUIRED);
        }

        const user = await this.userRepository.findOne({
            where: { email, isDeleted: false, isUserActive: true },
        });

        if (!user) {
            throw AppError.fromCode(ApiErrorCode.AUTH_PASSWORD_RESET_LINK_INVALID);
        }

        const passwordHash = crypto.createHmac('sha256', normalizedPassword).digest('hex');

        await this.userRepository.createQueryBuilder()
            .update(User)
            .set({ password: passwordHash })
            .where('id = :id', { id: user.id })
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


