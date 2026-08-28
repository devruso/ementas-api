import crypto from 'crypto';
import { getCustomRepository, Repository } from 'typeorm';

import { AppError } from '../errors/AppError';
import { Component } from '../entities/Component';
import { ComponentPublicShare } from '../entities/ComponentPublicShare';
import { User } from '../entities/User';
import { ComponentStatus } from '../interfaces/ComponentStatus';
import { UserRole } from '../interfaces/UserRole';
import { ComponentRepository } from '../repositories/ComponentRepository';
import { ComponentPublicShareRepository } from '../repositories/ComponentPublicShareRepository';
import { UserRepository } from '../repositories/UserRepository';

class ComponentPublicShareService {
    private componentRepository: Repository<Component>;
    private shareRepository: Repository<ComponentPublicShare>;
    private userRepository: Repository<User>;

    constructor() {
        this.componentRepository = getCustomRepository(ComponentRepository);
        this.shareRepository = getCustomRepository(ComponentPublicShareRepository);
        this.userRepository = getCustomRepository(UserRepository);
    }

    private isAdminRole(role?: UserRole) {
        return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
    }

    async createShare(componentId: string, userId: string, expiresInHours = 24) {
        const [component, user] = await Promise.all([
            this.componentRepository.findOne({ where: { id: componentId } }),
            this.userRepository.findOne({ where: { id: userId, isDeleted: false } }),
        ]);

        if (!component || component.status !== ComponentStatus.PUBLISHED) {
            throw new AppError('Only published components can be shared publicly.', 400);
        }

        if (!user) {
            throw new AppError('User not found.', 404);
        }

        const normalizedExpires = Number.isFinite(expiresInHours)
            ? Math.min(Math.max(Math.trunc(expiresInHours), 1), 168)
            : 24;

        // 72 bits keep the URL compact while retaining ample entropy for public links.
        const token = crypto.randomBytes(9).toString('base64url');
        const expiresAt = new Date(Date.now() + normalizedExpires * 60 * 60 * 1000);

        const share = this.shareRepository.create({
            componentId,
            createdBy: userId,
            token,
            expiresAt,
        });

        const createdShare = await this.shareRepository.save(share);

        return {
            id: createdShare.id,
            token: createdShare.token,
            expiresAt: createdShare.expiresAt,
            createdAt: createdShare.createdAt,
            createdBy: createdShare.createdBy,
        };
    }

    async listActiveShares(componentId: string, userId: string, options?: {
        page?: number;
        limit?: number;
        sortBy?: string;
        sortOrder?: 'ASC' | 'DESC';
        creatorId?: string;
        expirationRange?: '24h' | '72h' | '168h' | 'all';
    }) {
        const [component, actor] = await Promise.all([
            this.componentRepository.findOne({ where: { id: componentId } }),
            this.userRepository.findOne({ where: { id: userId, isDeleted: false } }),
        ]);

        if (!component) {
            throw new AppError('Component not found.', 404);
        }

        if (!actor) {
            throw new AppError('User not found.', 404);
        }

        const page = Math.max(0, Number(options?.page ?? 0));
        const limit = Math.min(Math.max(1, Number(options?.limit ?? 10)), 100);
        const sortOrder = options?.sortOrder === 'ASC' ? 'ASC' : 'DESC';
        const sortByMap: Record<string, string> = {
            createdAt: 'share.createdAt',
            expiresAt: 'share.expiresAt',
            createdBy: 'creator.name',
        };
        const sortBy = sortByMap[options?.sortBy ?? ''] || 'share.createdAt';
        const creatorId = options?.creatorId?.trim() || undefined;
        const expirationRange = options?.expirationRange || 'all';

        const query = this.shareRepository
            .createQueryBuilder('share')
            .leftJoinAndSelect('share.user', 'creator')
            .where('share.componentId = :componentId', { componentId })
            .andWhere('share.revokedAt IS NULL')
            .andWhere('share.expiresAt > :now', { now: new Date() })
            .orderBy(sortBy, sortOrder)
            .skip(page * limit)
            .take(limit);

        if (!this.isAdminRole(actor.role)) {
            query.andWhere('share.createdBy = :createdBy', { createdBy: actor.id });
        }

        if (this.isAdminRole(actor.role) && creatorId) {
            query.andWhere('share.createdBy = :creatorId', { creatorId });
        }

        if (expirationRange !== 'all') {
            const hoursLimit = expirationRange === '24h'
                ? 24
                : expirationRange === '72h'
                    ? 72
                    : 168;
            query.andWhere('share.expiresAt <= :expiresAtUpperBound', {
                expiresAtUpperBound: new Date(Date.now() + hoursLimit * 60 * 60 * 1000),
            });
        }

        const [activeShares, total] = await query.getManyAndCount();

        return {
            results: activeShares.map((share) => ({
                id: share.id,
                token: share.token,
                expiresAt: share.expiresAt,
                createdAt: share.createdAt,
                createdBy: share.createdBy,
                createdByUser: share.user
                    ? {
                        id: share.user.id,
                        name: share.user.name,
                        email: share.user.email,
                    }
                    : undefined,
            })),
            total,
        };
    }

    async revokeShare(shareId: string, userId: string) {
        const [share, actor] = await Promise.all([
            this.shareRepository.findOne({ where: { id: shareId } }),
            this.userRepository.findOne({ where: { id: userId, isDeleted: false } }),
        ]);

        if (!share) {
            throw new AppError('Public share not found.', 404);
        }

        if (!actor) {
            throw new AppError('User not found.', 404);
        }

        const canRevoke = share.createdBy === actor.id || this.isAdminRole(actor.role);

        if (!canRevoke) {
            throw new AppError('User cannot revoke this public share.', 401);
        }

        if (!share.revokedAt) {
            share.revokedAt = new Date();
            await this.shareRepository.save(share);
        }

        return share;
    }

    async revokeAllActiveShares(componentId: string, userId: string) {
        const [component, actor] = await Promise.all([
            this.componentRepository.findOne({ where: { id: componentId } }),
            this.userRepository.findOne({ where: { id: userId, isDeleted: false } }),
        ]);

        if (!component) {
            throw new AppError('Component not found.', 404);
        }

        if (!actor) {
            throw new AppError('User not found.', 404);
        }

        if (!this.isAdminRole(actor.role)) {
            throw new AppError('Only admin users can revoke all public shares.', 401);
        }

        const query = this.shareRepository
            .createQueryBuilder('share')
            .where('share.componentId = :componentId', { componentId })
            .andWhere('share.revokedAt IS NULL')
            .andWhere('share.expiresAt > :now', { now: new Date() });

        const activeShares = await query.getMany();

        if (activeShares.length === 0) {
            return { revokedCount: 0 };
        }

        const revokedAt = new Date();

        await this.shareRepository
            .createQueryBuilder()
            .update(ComponentPublicShare)
            .set({ revokedAt })
            .whereInIds(activeShares.map((share) => share.id))
            .execute();

        return { revokedCount: activeShares.length };
    }

    async getPublishedComponentByToken(token: string) {
        const share = await this.shareRepository
            .createQueryBuilder('share')
            .leftJoinAndSelect('share.component', 'component')
            .leftJoinAndSelect('component.workload', 'workload')
            .leftJoinAndSelect('component.logs', 'logs')
            .leftJoinAndSelect('logs.user', 'logs_user')
            .where('share.token = :token', { token })
            .orderBy('logs.createdAt', 'DESC')
            .getOne();

        if (!share) {
            throw new AppError('Public share not found.', 404);
        }

        if (share.revokedAt) {
            throw new AppError('Public share has been revoked.', 410);
        }

        if (new Date(share.expiresAt).getTime() <= Date.now()) {
            throw new AppError('Public share has expired.', 410);
        }

        if (!share.component || share.component.status !== ComponentStatus.PUBLISHED) {
            throw new AppError('Component is not available for public sharing.', 404);
        }

        return share.component;
    }
}

export { ComponentPublicShareService };
