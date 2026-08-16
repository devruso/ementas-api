import { MigrationInterface, QueryRunner } from 'typeorm';

export class enforceComponentRelationIntegrity1782500000000 implements MigrationInterface {
    name = 'enforceComponentRelationIntegrity1782500000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DELETE FROM "component_relations" relation
            USING (
                SELECT "id"
                FROM (
                    SELECT
                        "id",
                        ROW_NUMBER() OVER (
                            PARTITION BY "component_id", "relation_type", "related_code"
                            ORDER BY "created_at" ASC, "id" ASC
                        ) AS duplicate_rank
                    FROM "component_relations"
                ) ranked
                WHERE ranked.duplicate_rank > 1
            ) duplicates
            WHERE relation."id" = duplicates."id"
        `);

        await queryRunner.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM "pg_constraint"
                    WHERE "conrelid" = 'component_relations'::regclass
                      AND "conname" = 'UQ_component_relations_component_type_code'
                ) THEN
                    ALTER TABLE "component_relations"
                    ADD CONSTRAINT "UQ_component_relations_component_type_code"
                    UNIQUE ("component_id", "relation_type", "related_code");
                END IF;

                IF NOT EXISTS (
                    SELECT 1
                    FROM "pg_constraint"
                    WHERE "conrelid" = 'component_relations'::regclass
                      AND "conname" = 'CHK_component_relations_type'
                ) THEN
                    ALTER TABLE "component_relations"
                    ADD CONSTRAINT "CHK_component_relations_type"
                    CHECK ("relation_type" IN ('co_requisite', 'equivalence'));
                END IF;
            END $$
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "component_relations" DROP CONSTRAINT IF EXISTS "CHK_component_relations_type"');
        await queryRunner.query('ALTER TABLE "component_relations" DROP CONSTRAINT IF EXISTS "UQ_component_relations_component_type_code"');
    }
}
