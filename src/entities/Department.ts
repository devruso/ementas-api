import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { Component } from './Component';
import { ComponentDraft } from './ComponentDraft';

@Entity('departments')
@Index('IDX_departments_name', [ 'name' ])
@Index('IDX_departments_code', [ 'code' ])
class Department {
    @PrimaryGeneratedColumn('uuid')
    readonly id: string;

    @Column({ type: 'varchar' })
        name: string;

    @Column({ type: 'varchar', nullable: true })
        code?: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
        createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', nullable: true })
        updatedAt?: Date;

    @OneToMany(() => Component, (component) => component.departmentRef)
        components: Component[];

    @OneToMany(() => ComponentDraft, (draft) => draft.departmentRef)
        componentDrafts: ComponentDraft[];

    componentCount?: number;

    componentDraftCount?: number;
}

export { Department };
