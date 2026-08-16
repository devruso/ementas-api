import {
    Check,
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from 'typeorm';

import { Component } from './Component';
import { ComponentRelationType } from '../interfaces/ComponentRelationType';

@Entity('component_relations')
@Index('IDX_component_relations_component_id', [ 'componentId' ])
@Unique('UQ_component_relations_component_type_code', [ 'componentId', 'relationType', 'relatedCode' ])
@Check('CHK_component_relations_type', '"relation_type" IN (\'co_requisite\', \'equivalence\')')
class ComponentRelation {

    @PrimaryGeneratedColumn('uuid')
    readonly id: string;

    @Column({ name: 'component_id' })
        componentId: string;

    @Column({ name: 'relation_type', enum: ComponentRelationType })
        relationType: ComponentRelationType;

    @Column({ name: 'related_code' })
        relatedCode: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
        createdAt: Date;

    @ManyToOne(() => Component, (component) => component.relations, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'component_id' })
        component: Component;
}

export { ComponentRelation };
