import * as crypto from 'crypto';
import { Brackets, getCustomRepository, Repository } from 'typeorm';

import { User } from '../entities/User';
import { UserRepository } from '../repositories/UserRepository';
import { AppError } from '../errors/AppError';
import Mailer from '../middlewares/Mailer';
import { UserRole } from '../interfaces/UserRole';
import { assertUfbaInstitutionalEmail, normalizeEmail } from '../helpers/institutionalEmail';
import { UserInviteService } from './UserInviteService';
import { createStorageProvider } from './storage';
import { StorageProviderKind } from './storage';
import { SignatureImageUploadValidator } from './signature/SignatureImageUploadValidator';
import { buildInviteEmailTemplate, buildTeacherCredentialsEmailTemplate } from '../helpers/emailTemplates';

class UserService {

    private userRepository : Repository<User>;

    constructor() {
        this.userRepository = getCustomRepository(UserRepository);
    }

    private isAdminRole(role?: UserRole) {
        return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
    }

    private generateTemporaryPassword(length = 12) {
        const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        const lower = 'abcdefghijkmnopqrstuvwxyz';
        const numbers = '23456789';
        const symbols = '@$!%*?&';
        const allChars = upper + lower + numbers + symbols;

        const required = [
            upper[crypto.randomInt(0, upper.length)],
            lower[crypto.randomInt(0, lower.length)],
            numbers[crypto.randomInt(0, numbers.length)],
            symbols[crypto.randomInt(0, symbols.length)],
        ];

        while (required.length < length) {
            required.push(allChars[crypto.randomInt(0, allChars.length)]);
        }

        for (let index = required.length - 1; index > 0; index -= 1) {
            const randomIndex = crypto.randomInt(0, index + 1);
            const current = required[index];
            required[index] = required[randomIndex];
            required[randomIndex] = current;
        }

        return required.join('');
    }

    async getUsers(options?: {
        search?: string;
        sortBy?: string;
        sortOrder?: 'ASC' | 'DESC';
        excludeUserId?: string;
    }) {
        const search = options?.search?.trim().toLowerCase();
        const sortMap: Record<string, string> = {
            name: 'users.name',
            email: 'users.email',
            role: 'users.role',
            createdAt: 'users.createdAt',
            updatedAt: 'users.updatedAt',
        };
        const sortBy = sortMap[options?.sortBy ?? ''] ?? 'users.createdAt';
        const sortOrder = options?.sortOrder ?? 'DESC';

        const query = this.userRepository
            .createQueryBuilder('users')
            .where('users.isDeleted = false');

        if (options?.excludeUserId) {
            query.andWhere('users.id != :excludeUserId', {
                excludeUserId: options.excludeUserId,
            });
        }

        if (search) {
            query.andWhere(new Brackets((subQuery) => {
                subQuery
                    .where('LOWER(users.name) LIKE :search', { search: `%${search}%` })
                    .orWhere('LOWER(users.email) LIKE :search', { search: `%${search}%` });
            }));
        }

        const users = await query.orderBy(sortBy, sortOrder).getMany();

        if (users.length === 0) return [];

        return users;
    }

    async getUserByID(id: string){
        const user = await this.userRepository.findOne({
            where: { id },
        });

        if (!user) return null;

        return user;
    }

    async create(name: string, email: string, password: string){
        const normalizedEmail = normalizeEmail(email);

        if (!assertUfbaInstitutionalEmail(normalizedEmail)) {
            throw new AppError('Only UFBA institutional email addresses are allowed.', 400);
        }

        const userExists = await this.userRepository.findOne({
            where: { email: normalizedEmail },
        });

        if (userExists) {
            throw new AppError('User already exists.', 400);
        }

        try {
            const user = this.userRepository.create({
                name,
                email: normalizedEmail,
                password: crypto.createHmac('sha256', password).digest('hex'),
            });

            return await this.userRepository.save(user);
        }
        catch (err) {
            throw new AppError('An error has been occurred.', 400);
        }
    }

    async createTeacherByAdmin(
        authenticatedUserId: string,
        name: string,
        email: string,
        sendCredentialsByEmail = true
    ) {
        const adminUser = await this.userRepository.findOne({
            where: { id: authenticatedUserId, isDeleted: false },
        });

        if (!adminUser || !this.isAdminRole(adminUser.role)) {
            throw new AppError('Only admin users can create teachers.', 401);
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (!assertUfbaInstitutionalEmail(normalizedEmail)) {
            throw new AppError('Only UFBA institutional email addresses are allowed.', 400);
        }

        const userExists = await this.userRepository.findOne({
            where: { email: normalizedEmail },
        });

        if (userExists) {
            throw new AppError('User already exists.', 400);
        }

        const temporaryPassword = this.generateTemporaryPassword();
        const passwordHash = crypto.createHmac('sha256', temporaryPassword).digest('hex');

        const user = this.userRepository.create({
            name: name.trim(),
            email: normalizedEmail,
            password: passwordHash,
            role: UserRole.TEACHER,
        });

        const createdUser = await this.userRepository.save(user);

        let emailDeliveryStatus: 'sent' | 'mock' | 'failed' | 'disabled' = 'disabled';
        let emailDeliveryError: string | undefined;

        if (sendCredentialsByEmail) {
            try {
                const credentialsEmail = buildTeacherCredentialsEmailTemplate(
                    name.trim(),
                    normalizedEmail,
                    temporaryPassword,
                    adminUser.name
                );

                const mailDelivery = await Mailer.execute(
                    normalizedEmail,
                    'Acesso EMENTAS - Credenciais iniciais',
                    credentialsEmail
                );

                emailDeliveryStatus = mailDelivery.deliveryMode === 'mock' ? 'mock' : 'sent';
            } catch (error) {
                emailDeliveryStatus = 'failed';
                emailDeliveryError = error instanceof Error
                    ? error.message
                    : 'Falha inesperada no envio de e-mail.';
            }
        }

        return {
            id: createdUser.id,
            name: createdUser.name,
            email: createdUser.email,
            temporaryPassword,
            emailDeliveryStatus,
            emailDeliveryError,
        };
    }

    async sendInviteByEmail(
        authenticatedUserId: string,
        email: string,
        registrationBaseUrl: string
    ) {
        const adminUser = await this.userRepository.findOne({
            where: { id: authenticatedUserId, isDeleted: false },
        });

        if (!adminUser || !this.isAdminRole(adminUser.role)) {
            throw new AppError('Only admin users can send invite by e-mail.', 401);
        }

        const normalizedEmail = normalizeEmail(email);

        if (!assertUfbaInstitutionalEmail(normalizedEmail)) {
            throw new AppError('Only UFBA institutional email addresses are allowed.', 400);
        }

        const normalizedBaseUrl = registrationBaseUrl.trim().replace(/\/+$/, '');

        if (!/^https?:\/\//i.test(normalizedBaseUrl)) {
            throw new AppError('Invalid registration base URL. Use a full URL, e.g. http://localhost:3000.', 400);
        }

        const token = new UserInviteService().generateUserInvite();
        const inviteLink = `${normalizedBaseUrl}/cadastrar/${token}`;
        const inviteEmail = buildInviteEmailTemplate(inviteLink);
        let mailDeliveryStatus: 'sent' | 'mock' | 'failed' = 'failed';
        let emailDeliveryError: string | undefined;

        try {
            const mailDelivery = await Mailer.execute(
                normalizedEmail,
                'Convite EMENTAS - Cadastro',
                inviteEmail
            );

            mailDeliveryStatus = mailDelivery.deliveryMode;
        } catch (error) {
            mailDeliveryStatus = 'failed';
            emailDeliveryError = error instanceof Error
                ? error.message
                : 'Falha inesperada no envio de e-mail de convite.';
        }

        return {
            email: normalizedEmail,
            token,
            inviteLink,
            emailDeliveryStatus: mailDeliveryStatus,
            emailDeliveryError,
        };
    }

    async updateSignature(userId: string, signature: string) {
        const user = await this.userRepository.findOne({ where: { id: userId, isDeleted: false } });

        if (!user) {
            throw new AppError('User not found.', 404);
        }

        const signatureHash = crypto.createHmac('sha256', signature.trim()).digest('hex');

        await this.userRepository
            .createQueryBuilder()
            .update(User)
            .set({ signatureHash, signatureUpdatedAt: new Date() })
            .where('id = :id', { id: userId })
            .execute();

        return this.userRepository.findOne({ where: { id: userId } });
    }

    async updateSignatureFile(userId: string, file?: Express.Multer.File, signature?: string) {
        const user = await this.userRepository.findOne({ where: { id: userId, isDeleted: false } });

        if (!user) {
            throw new AppError('User not found.', 404);
        }

        if (!file) {
            throw new AppError('Nenhum arquivo de assinatura foi enviado.', 400);
        }

        const normalizedFile = SignatureImageUploadValidator.validateAndNormalize(file);

        const storageProvider = createStorageProvider();
        const fileName = `${user.id}-${Date.now()}.${normalizedFile.extension}`;

        const savedFile = await storageProvider.save({
            folder: 'signatures',
            fileName,
            content: normalizedFile.buffer,
            contentType: normalizedFile.contentType,
        });

        if (user.signatureFileKey && user.signatureFileProvider === storageProvider.kind) {
            await storageProvider.delete(user.signatureFileKey);
        }

        const normalizedSignature = signature?.trim();
        const nextSignatureHash = normalizedSignature
            ? crypto.createHmac('sha256', normalizedSignature).digest('hex')
            : user.signatureHash;

        await this.userRepository
            .createQueryBuilder()
            .update(User)
            .set({
                signatureHash: nextSignatureHash,
                signatureUpdatedAt: new Date(),
                signatureFileKey: savedFile.key,
                signatureFileProvider: savedFile.provider,
                signatureFileContentType: savedFile.contentType,
                signatureFileSize: savedFile.size,
                signatureFileHash: crypto.createHash('sha256').update(normalizedFile.buffer).digest('hex'),
            })
            .where('id = :id', { id: userId })
            .execute();

        return this.userRepository.findOne({ where: { id: userId } });
    }

    async getSignatureFilePreview(userId: string) {
        const user = await this.userRepository.findOne({ where: { id: userId, isDeleted: false } });

        if (!user) {
            throw new AppError('User not found.', 404);
        }

        if (!user.signatureFileKey || !user.signatureFileProvider || !user.signatureFileContentType) {
            throw new AppError('Nenhum arquivo de assinatura foi configurado para este usuÃ¡rio.', 404);
        }

        if (!/^image\//i.test(user.signatureFileContentType)) {
            throw new AppError('O arquivo de assinatura atual nÃ£o pode ser exibido como imagem.', 400);
        }

        const storageProvider = createStorageProvider(user.signatureFileProvider as StorageProviderKind);
        const content = await storageProvider.read(user.signatureFileKey);

        return {
            content,
            contentType: user.signatureFileContentType,
        };
    }

    async updateUserRole(
        authenticatedUserId: string,
        targetUserId: string,
        role: UserRole
    ) {
        const [actor, targetUser] = await Promise.all([
            this.userRepository.findOne({ where: { id: authenticatedUserId, isDeleted: false } }),
            this.userRepository.findOne({ where: { id: targetUserId, isDeleted: false } }),
        ]);

        if (!actor || actor.role !== UserRole.SUPER_ADMIN) {
            throw new AppError('Only super admin can update user roles.', 401);
        }

        if (!targetUser) {
            throw new AppError('User not found.', 404);
        }

        if (targetUser.id === actor.id && role !== UserRole.SUPER_ADMIN) {
            throw new AppError('Super admin cannot remove own super admin role.', 400);
        }

        await this.userRepository
            .createQueryBuilder()
            .update(User)
            .set({ role })
            .where('id = :id', { id: targetUser.id })
            .execute();

        return this.userRepository.findOne({ where: { id: targetUser.id } });
    }

    async updatePassword(id: string, password: string){
        const userExists = await this.userRepository.findOne({
            where: { id }
        });

        if(!userExists){
            throw new AppError('User not found.', 404);
        }

        try {
            const passwordHashed = crypto.createHmac('sha256', password).digest('hex');

            await this.userRepository.createQueryBuilder().update(User).set({ password: passwordHashed }).where('id = :id', { id }).execute();

            return await this.userRepository.findOne({
                where: { id }
            });
        }
        catch (err) {
            throw new AppError('An error has been occurred.', 400);
        }
    }

    async updateEmail(id: string, email: string){
        const normalizedEmail = normalizeEmail(email);

        if (!assertUfbaInstitutionalEmail(normalizedEmail)) {
            throw new AppError('Only UFBA institutional email addresses are allowed.', 400);
        }

        const userExists = await this.userRepository.findOne({
            where: { id }
        });

        if(!userExists){
            throw new AppError('User not found.', 404);
        }

        try {
            await this.userRepository.createQueryBuilder().update(User).set({ email: normalizedEmail }).where('id = :id', { id }).execute();

            return await this.userRepository.findOne({
                where: { id }
            });
        }
        catch (err) {
            throw new AppError('An error has been occurred.', 400);
        }
    }

    async delete(authenticatedUserId: string, id: string){
        const [actor, userExists] = await Promise.all([
            this.userRepository.findOne({
                where: { id: authenticatedUserId, isDeleted: false }
            }),
            this.userRepository.findOne({
                where: { id, isDeleted: false }
            }),
        ]);

        if (!actor || actor.role !== UserRole.SUPER_ADMIN) {
            throw new AppError('Only super admin can remove users.', 401);
        }

        if(actor.id === id){
            throw new AppError('Super admin cannot remove own account.', 400);
        }

        if(!userExists){
            throw new AppError('User not found.', 404);
        }

        await this.userRepository
            .createQueryBuilder()
            .update(User)
            .set({ isDeleted: true, isUserActive: false })
            .where('id = :id', { id })
            .execute();
    }

}

export { UserService };


