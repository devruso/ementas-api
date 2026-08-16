import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('user_invite_short_links')
@Index('IDX_user_invite_short_links_expires_at', [ 'expiresAt' ])
class UserInviteShortLink {
    @PrimaryGeneratedColumn('uuid')
    readonly id: string;

    @Column({ name: 'short_code', unique: true })
        shortCode: string;

    @Column({ name: 'invite_token', type: 'text' })
        inviteToken: string;

    @Column({ name: 'recipient_email' })
        recipientEmail: string;

    @Column({ name: 'expires_at', type: 'timestamptz' })
        expiresAt: Date;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
        createdAt: Date;
}

export { UserInviteShortLink };
