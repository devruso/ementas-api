import { MigrationInterface, QueryRunner } from 'typeorm';

export class reconcileForeignKeys1782700000000 implements MigrationInterface {
    name = 'reconcileForeignKeys1782700000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "component_relations"
                DROP CONSTRAINT IF EXISTS "FK_component_relations_component",
                DROP CONSTRAINT IF EXISTS "FK_a8bc4bab7667c8bb30905571ca1";
            ALTER TABLE "component_relations"
                ADD CONSTRAINT "FK_a8bc4bab7667c8bb30905571ca1"
                FOREIGN KEY ("component_id") REFERENCES "components"("id") ON DELETE CASCADE;

            ALTER TABLE "component_public_shares"
                DROP CONSTRAINT IF EXISTS "FK_component_public_shares_component",
                DROP CONSTRAINT IF EXISTS "FK_0cc18c5c9a7cb84ac6f725b5367",
                DROP CONSTRAINT IF EXISTS "FK_component_public_shares_user",
                DROP CONSTRAINT IF EXISTS "FK_c24a489fb3bcb5431bf5915853f";
            ALTER TABLE "component_public_shares"
                ADD CONSTRAINT "FK_0cc18c5c9a7cb84ac6f725b5367"
                FOREIGN KEY ("component_id") REFERENCES "components"("id") ON DELETE CASCADE;
            ALTER TABLE "component_public_shares"
                ADD CONSTRAINT "FK_c24a489fb3bcb5431bf5915853f"
                FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE;
        `);

        await queryRunner.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM "pg_constraint"
                    WHERE "conrelid" = 'components'::regclass
                      AND "conname" = 'FK_components_department_id'
                ) AND NOT EXISTS (
                    SELECT 1 FROM "pg_constraint"
                    WHERE "conrelid" = 'components'::regclass
                      AND "conname" = 'FK_0cd61f11239fc5bc0ef7667182f'
                ) THEN
                    ALTER TABLE "components"
                    RENAME CONSTRAINT "FK_components_department_id" TO "FK_0cd61f11239fc5bc0ef7667182f";
                END IF;

                IF EXISTS (
                    SELECT 1 FROM "pg_constraint"
                    WHERE "conrelid" = 'component_drafts'::regclass
                      AND "conname" = 'FK_component_drafts_department_id'
                ) AND NOT EXISTS (
                    SELECT 1 FROM "pg_constraint"
                    WHERE "conrelid" = 'component_drafts'::regclass
                      AND "conname" = 'FK_90b762c4a6f224ae9de07227e61'
                ) THEN
                    ALTER TABLE "component_drafts"
                    RENAME CONSTRAINT "FK_component_drafts_department_id" TO "FK_90b762c4a6f224ae9de07227e61";
                END IF;
            END $$
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "component_public_shares"
                DROP CONSTRAINT IF EXISTS "FK_c24a489fb3bcb5431bf5915853f",
                DROP CONSTRAINT IF EXISTS "FK_0cc18c5c9a7cb84ac6f725b5367";
            ALTER TABLE "component_relations"
                DROP CONSTRAINT IF EXISTS "FK_a8bc4bab7667c8bb30905571ca1";
        `);
    }
}
