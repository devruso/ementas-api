import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { Component } from './Component';
import { ComponentDraft } from './ComponentDraft';
import { UserRole } from '../interfaces/UserRole';

@Entity('users')
@Index('UQ_users_email_not_deleted', [ 'email' ], { unique: true, where: '"is_deleted" = false' })
class User {
    @PrimaryGeneratedColumn('uuid')
    readonly id: string;

    @Column()
        name: string;

    @Column()
        email: string;

    @Column({ select: false })
        password: string;

    @Column({ name: 'is_user_active', default: true })
        isUserActive: boolean;

    @Column({ name: 'is_deleted', default: false })
        isDeleted: boolean;

    @Column({ default: UserRole.TEACHER })
        role: UserRole;

    @Column({ name: 'signature_hash', nullable: true })
        signatureHash?: string;

    @Column({ name: 'signature_updated_at', type: 'timestamptz', nullable: true })
        signatureUpdatedAt?: Date;

    @Column({ name: 'signature_file_key', nullable: true })
        signatureFileKey?: string;

    @Column({ name: 'signature_file_provider', nullable: true })
        signatureFileProvider?: string;

    @Column({ name: 'signature_file_content_type', nullable: true })
        signatureFileContentType?: string;

    @Column({ name: 'signature_file_size', type: 'integer', nullable: true })
        signatureFileSize?: number;

    @Column({ name: 'signature_file_hash', nullable: true })
        signatureFileHash?: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
        createdAt: Date;

    @UpdateDateColumn({
        name: 'updated_at',
        type: 'timestamptz',
        nullable: true,
    })
        updatedAt?: Date;

    @OneToMany(() => Component, (component) => component.user)
        components: Component[];

    @OneToMany(() => ComponentDraft, (component) => component.user)
        componentDrafts: ComponentDraft[];
}

export { User };
