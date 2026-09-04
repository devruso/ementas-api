import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { Component } from './Component';
import { ComponentDraft } from './ComponentDraft';

@Entity('courses')
@Index('IDX_courses_name', [ 'name' ])
@Index('IDX_courses_code', [ 'code' ])
class Course {
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

    @OneToMany(() => Component, (component) => component.courseRef)
        components: Component[];

    @OneToMany(() => ComponentDraft, (draft) => draft.courseRef)
        componentDrafts: ComponentDraft[];

    componentCount?: number;

    componentDraftCount?: number;
}

export { Course };
