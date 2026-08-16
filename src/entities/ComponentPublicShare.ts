import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';

import { Component } from './Component';
import { User } from './User';

@Entity('component_public_shares')
class ComponentPublicShare {
    @PrimaryGeneratedColumn('uuid')
        id: string;

    @Column({ name: 'component_id' })
        componentId: string;

    @Column({ name: 'created_by' })
        createdBy: string;

    @Column({ unique: true })
        token: string;

    @Column({ name: 'expires_at', type: 'timestamptz' })
        expiresAt: Date;

    @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
        revokedAt?: Date | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
        createdAt: Date;

    @ManyToOne(() => Component, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'component_id' })
        component: Component;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'created_by' })
        user: User;
}

export { ComponentPublicShare };
