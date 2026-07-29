import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

import { AcademicLevel } from '../interfaces/AcademicLevel';
import { Component } from './Component';

@Entity('component_curriculum_contexts')
class ComponentCurriculumContext {

    @PrimaryGeneratedColumn('uuid')
    readonly id: string;

    @Column({ name: 'component_id' })
        componentId: string;

    @Column({ name: 'source_key' })
        sourceKey: string;

    @Column({ name: 'curriculum_code' })
        curriculumCode: string;

    @Column({ name: 'curriculum_name', default: '' })
        curriculumName: string;

    @Column({ name: 'course_name', default: '' })
        courseName: string;

    @Column({ name: 'implementation_semester', default: '' })
        implementationSemester: string;

    @Column({ name: 'recommended_period', type: 'integer', nullable: true })
        recommendedPeriod?: number | null;

    @Column({ name: 'is_required', default: false })
        isRequired: boolean;

    @Column({ name: 'is_active', default: false })
        isActive: boolean;

    @Column({ name: 'prerequeriments', type: 'text', default: '' })
        prerequeriments: string;

    @Column({ name: 'academic_level', enum: AcademicLevel, default: AcademicLevel.GRADUATION })
        academicLevel: AcademicLevel;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
        createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', nullable: true })
        updatedAt?: Date;

    @ManyToOne(() => Component, (component) => component.curriculumContexts, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'component_id' })
        component: Component;
}

export { ComponentCurriculumContext };
