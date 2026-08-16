import { MigrationInterface, QueryRunner } from 'typeorm';

const MIGRATION_CONSTRAINT_NAME = 'FK_component_curriculum_contexts_component';
const TYPEORM_CONSTRAINT_NAME = 'FK_101a50e61f8ad7fbf288b1ec9cd';

export class alignCurriculumContextForeignKeyName1782600000000 implements MigrationInterface {
    name = 'alignCurriculumContextForeignKeyName1782600000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM "pg_constraint"
                    WHERE "conrelid" = 'component_curriculum_contexts'::regclass
                      AND "conname" = '${MIGRATION_CONSTRAINT_NAME}'
                ) AND NOT EXISTS (
                    SELECT 1 FROM "pg_constraint"
                    WHERE "conrelid" = 'component_curriculum_contexts'::regclass
                      AND "conname" = '${TYPEORM_CONSTRAINT_NAME}'
                ) THEN
                    ALTER TABLE "component_curriculum_contexts"
                    RENAME CONSTRAINT "${MIGRATION_CONSTRAINT_NAME}" TO "${TYPEORM_CONSTRAINT_NAME}";
                END IF;
            END $$
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM "pg_constraint"
                    WHERE "conrelid" = 'component_curriculum_contexts'::regclass
                      AND "conname" = '${TYPEORM_CONSTRAINT_NAME}'
                ) AND NOT EXISTS (
                    SELECT 1 FROM "pg_constraint"
                    WHERE "conrelid" = 'component_curriculum_contexts'::regclass
                      AND "conname" = '${MIGRATION_CONSTRAINT_NAME}'
                ) THEN
                    ALTER TABLE "component_curriculum_contexts"
                    RENAME CONSTRAINT "${TYPEORM_CONSTRAINT_NAME}" TO "${MIGRATION_CONSTRAINT_NAME}";
                END IF;
            END $$
        `);
    }
}
