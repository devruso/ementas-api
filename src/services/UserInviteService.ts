import { sign } from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { getRepository, MoreThan } from 'typeorm';
import { AppError } from '../errors/AppError';
import { verifyAuthToken } from '../helpers/verifyAuthToken';
import { UserInviteShortLink } from '../entities/UserInviteShortLink';

class UserInviteService {
    private readonly inviteExpirationInSeconds = 86400;

    async cleanupExpiredShortLinks() {
        const inviteShortLinkRepository = getRepository(UserInviteShortLink);

        const deleteResult = await inviteShortLinkRepository
            .createQueryBuilder()
            .delete()
            .from(UserInviteShortLink)
            .where('expires_at <= :now', { now: new Date() })
            .execute();

        return deleteResult.affected || 0;
    }

    generateUserInvite() {
        const generatedHash = Math.random().toString(36).substring(2);
        const token = sign({ generatedHash }, String(process.env.JWT_SECRET), { expiresIn: this.inviteExpirationInSeconds });

        return token;
    }

    private generateShortCode(length = 10) {
        // URL-safe and compact code for links embedded in e-mails.
        return randomBytes(16)
            .toString('base64')
            .replace(/[^a-zA-Z0-9]/g, '')
            .slice(0, length);
    }

    async createShortLinkForInvite(inviteToken: string, recipientEmail: string) {
        const inviteShortLinkRepository = getRepository(UserInviteShortLink);
        const expiresAt = new Date(Date.now() + this.inviteExpirationInSeconds * 1000);

        await this.cleanupExpiredShortLinks();

        for (let attempt = 0; attempt < 5; attempt += 1) {
            const shortCode = this.generateShortCode();

            const existing = await inviteShortLinkRepository.findOne({ where: { shortCode } });

            if (existing) {
                continue;
            }

            const created = await inviteShortLinkRepository.save(
                inviteShortLinkRepository.create({
                    shortCode,
                    inviteToken,
                    recipientEmail,
                    expiresAt,
                })
            );

            return created;
        }

        throw new AppError('Could not generate a short invite link. Try again.', 500);
    }

    async resolveShortInvite(shortCode: string) {
        const normalizedShortCode = String(shortCode || '').trim();

        await this.cleanupExpiredShortLinks();

        if (!normalizedShortCode) {
            throw new AppError('This invite is invalid or already expired.', 401);
        }

        const inviteShortLinkRepository = getRepository(UserInviteShortLink);

        const inviteShortLink = await inviteShortLinkRepository.findOne({
            where: {
                shortCode: normalizedShortCode,
                expiresAt: MoreThan(new Date()),
            },
        });

        if (!inviteShortLink) {
            throw new AppError('This invite is invalid or already expired.', 401);
        }

        this.validateUserInvite(inviteShortLink.inviteToken);

        return inviteShortLink.inviteToken;
    }

    validateUserInvite(token: string) {
        try {
            return verifyAuthToken(token);
        }
        catch (error) {
            throw new AppError('This invite is invalid or already expired.', 401);
        }
    }
}

export { UserInviteService };
