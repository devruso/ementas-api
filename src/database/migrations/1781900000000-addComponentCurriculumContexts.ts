import { MigrationInterface, QueryRunner } from 'typeorm';

export class addComponentCurriculumContexts1781900000000 implements MigrationInterface {
    name = 'addComponentCurriculumContexts1781900000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query("CREATE TABLE \"component_curriculum_contexts\" (\"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"component_id\" uuid NOT NULL, \"source_key\" character varying NOT NULL, \"curriculum_code\" character varying NOT NULL, \"curriculum_name\" character varying NOT NULL DEFAULT '', \"course_name\" character varying NOT NULL DEFAULT '', \"implementation_semester\" character varying NOT NULL DEFAULT '', \"recommended_period\" integer, \"is_required\" boolean NOT NULL DEFAULT false, \"is_active\" boolean NOT NULL DEFAULT false, \"prerequeriments\" text NOT NULL DEFAULT '', \"academic_level\" character varying NOT NULL DEFAULT 'graduacao', \"created_at\" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), \"updated_at\" TIMESTAMP WITH TIME ZONE DEFAULT now(), CONSTRAINT \"UQ_component_curriculum_contexts_source\" UNIQUE (\"component_id\", \"source_key\"), CONSTRAINT \"CHK_component_curriculum_contexts_academic_level\" CHECK (\"academic_level\" IN ('graduacao', 'mestrado', 'doutorado')), CONSTRAINT \"PK_component_curriculum_contexts_id\" PRIMARY KEY (\"id\"))");
        await queryRunner.query("CREATE INDEX \"IDX_component_curriculum_contexts_component_id\" ON \"component_curriculum_contexts\" (\"component_id\")");
        await queryRunner.query("CREATE INDEX \"IDX_component_curriculum_contexts_curriculum_code\" ON \"component_curriculum_contexts\" (\"curriculum_code\")");
        await queryRunner.query("ALTER TABLE \"component_curriculum_contexts\" ADD CONSTRAINT \"FK_component_curriculum_contexts_component\" FOREIGN KEY (\"component_id\") REFERENCES \"components\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION");
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query("ALTER TABLE \"component_curriculum_contexts\" DROP CONSTRAINT \"FK_component_curriculum_contexts_component\"");
        await queryRunner.query("DROP INDEX \"IDX_component_curriculum_contexts_curriculum_code\"");
        await queryRunner.query("DROP INDEX \"IDX_component_curriculum_contexts_component_id\"");
        await queryRunner.query("DROP TABLE \"component_curriculum_contexts\"");
    }
}
