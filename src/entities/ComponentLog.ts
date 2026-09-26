import { Column, Entity, CreateDateColumn, ManyToOne, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';

import { Component } from './Component';
import { User } from './User';
import { ComponentLogType } from '../interfaces/ComponentLogType';
import { ComponentDraft } from './ComponentDraft';

@Entity('component_logs')
class ComponentLog {

    @PrimaryGeneratedColumn('uuid')
        id: string;

    @Column({ name: 'component_id', nullable: true })
        componentId?: string | null;

    @Column({ name: 'component_draft_id', nullable: true })
        draftId?: string | null;

    @Column({ name: 'updated_by', nullable: true })
        updatedBy?: string;

    @Column({ name: 'agreement_number', nullable: true })
        agreementNumber?: string;

    @Column({ name: 'agreement_date', type: 'timestamptz',  nullable: true })
        agreementDate?: Date;

    @Column({ name: 'version_code', nullable: true })
        versionCode?: string;

    @Column({ name: 'official_program', type: 'text', nullable: true })
        officialProgram?: string;

    @Column({ name: 'official_syllabus', type: 'text', nullable: true })
        officialSyllabus?: string;

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

    @Column({ nullable: true })
        description?: string;

    @Column({ enum: ComponentLogType })
        type: ComponentLogType;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
        createdAt: Date;

    @ManyToOne(() => Component, (component) => component.logs)
    @JoinColumn({ name: 'component_id' })
        component?: Component;

    @ManyToOne(() => ComponentDraft, (draft) => draft.logs)
    @JoinColumn({ name: 'component_draft_id' })
        draft?: ComponentDraft;

    @ManyToOne(() => User, { eager: true })
    @JoinColumn({ name: 'updated_by' })
        user: User;

}

export { ComponentLog };
