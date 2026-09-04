import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    OneToMany,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { User } from './User';
import { ComponentWorkload } from './ComponentWorkload';
import { ComponentLog } from './ComponentLog';
import { ComponentLogType } from '../interfaces/ComponentLogType';
import { Component } from './Component';
import {
    AcademicLevel,
    COMPONENT_ACADEMIC_LEVELS,
    ComponentAcademicLevel,
} from '../interfaces/AcademicLevel';
import { Department } from './Department';
import { Course } from './Course';

@Entity('component_drafts')
@Index('IDX_component_drafts_department_id', [ 'departmentId' ])
@Index('IDX_component_drafts_course_id', [ 'courseId' ])
class ComponentDraft {

    @PrimaryGeneratedColumn('uuid')
    readonly id: string;

    @Column({ name: 'component_id' })
        componentId: string;

    @Column({ name: 'created_by' })
        userId: string;

    @Column({ name: 'workload_id', nullable: true })
        workloadId?: string;

    @Column({ unique: true })
        code: string;

    @Column({ default: '' })
        name?: string;

    @Column({ default: '' })
        department?: string;

    @Column({ name: 'department_id', nullable: true })
        departmentId?: string | null;

    @Column({ name: 'course_id', nullable: true })
        courseId?: string | null;

    @Column({ default: '' })
        modality: string;

    @Column({ default: '' })
        program?: string;

    @Column({ default: '' })
        semester?: string;

    @Column({ name: 'academic_level', enum: COMPONENT_ACADEMIC_LEVELS, default: AcademicLevel.GRADUATION })
        academicLevel: ComponentAcademicLevel;

    @Column({ default: '' })
        prerequeriments?: string;

    @Column({ default: '' })
        methodology?: string;

    @Column({ default: '' })
        objective?: string;

    @Column({ default: '' })
        syllabus?: string;

    @Column({ default: '' })
        learningAssessment: string;

    @Column({ default: '' })
        bibliography?: string;

    @Column({ default: '' })
        referencesBasic?: string;

    @Column({ default: '' })
        referencesComplementary?: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
        createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', nullable: true })
        updatedAt?: Date;

    @ManyToOne(() => User, (user) => user.componentDrafts)
    @JoinColumn({ name: 'created_by' })
        user: User;

    @ManyToOne(() => Department, (department) => department.componentDrafts, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'department_id' })
        departmentRef?: Department;

    @ManyToOne(() => Course, (course) => course.componentDrafts, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'course_id' })
        courseRef?: Course;
    
    @OneToOne(() => ComponentWorkload, (componentWorkload) => componentWorkload.componentDraft)
    @JoinColumn({ name: 'workload_id' })
        workload?: ComponentWorkload;

    @OneToOne(() => Component, (component) => component.draft)
    @JoinColumn({ name: 'component_id' })
        component: Component;

    @OneToMany(() => ComponentLog, (componentLog) => componentLog.draft)
        logs: ComponentLog[];

    generateDraftLog(
        type: ComponentLogType,
        authorId: string,
        componentId?: string
    ): ComponentLog {
        const log = new ComponentLog();
        log.type = type;
        log.updatedBy = authorId;

        if (type === ComponentLogType.DRAFT_CREATION) {
            log.componentId = componentId ?? this.id;
            log.description = `Rascunho criado em ${this.createdAt.toISOString()}`;
        } else if (type === ComponentLogType.DRAFT_UPDATE) {
            log.draftId = this.id;
            log.description = 'Rascunho alterado';
        }

        return log;
    }
}

export { ComponentDraft };
