import { MigrationInterface, QueryRunner } from 'typeorm';

export class reconcileLegacySchema1782400000000 implements MigrationInterface {
    name = 'reconcileLegacySchema1782400000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DO $$
            DECLARE email_constraint record;
            BEGIN
                FOR email_constraint IN
                    SELECT c."conname"
                    FROM "pg_constraint" c
                    JOIN "pg_attribute" a
                      ON a."attrelid" = c."conrelid"
                     AND a."attnum" = c."conkey"[1]
                    WHERE c."conrelid" = 'users'::regclass
                      AND c."contype" = 'u'
                      AND array_length(c."conkey", 1) = 1
                      AND a."attname" = 'email'
                LOOP
                    EXECUTE format('ALTER TABLE "users" DROP CONSTRAINT %I', email_constraint."conname");
                END LOOP;
            END $$
        `);

        await queryRunner.query(`
            WITH ranked_users AS (
                SELECT
                    "id",
                    ROW_NUMBER() OVER (
                        PARTITION BY LOWER(BTRIM("email"))
                        ORDER BY
                            CASE "role"
                                WHEN 'super_admin' THEN 3
                                WHEN 'admin' THEN 2
                                ELSE 1
                            END DESC,
                            "is_user_active" DESC,
                            "updated_at" DESC NULLS LAST,
                            "created_at" DESC,
                            "id" DESC
                    ) AS duplicate_rank
                FROM "users"
                WHERE "is_deleted" = false
            )
            UPDATE "users" u
            SET "is_deleted" = true,
                "is_user_active" = false,
                "updated_at" = NOW()
            FROM ranked_users ranked
            WHERE u."id" = ranked."id"
              AND ranked.duplicate_rank > 1
        `);

        await queryRunner.query('UPDATE "users" SET "email" = LOWER(BTRIM("email")) WHERE "email" <> LOWER(BTRIM("email"))');
        await queryRunner.query('DROP INDEX IF EXISTS "UQ_users_email_not_deleted"');
        await queryRunner.query('CREATE UNIQUE INDEX "UQ_users_email_not_deleted" ON "users" ("email") WHERE "is_deleted" = false');

        await queryRunner.query(`
            WITH ranked_departments AS (
                SELECT
                    "id",
                    FIRST_VALUE("id") OVER (
                        PARTITION BY LOWER(BTRIM("name"))
                        ORDER BY "created_at" ASC, "id" ASC
                    ) AS keeper_id,
                    ROW_NUMBER() OVER (
                        PARTITION BY LOWER(BTRIM("name"))
                        ORDER BY "created_at" ASC, "id" ASC
                    ) AS duplicate_rank
                FROM "departments"
            )
            UPDATE "components" component
            SET "department_id" = ranked.keeper_id
            FROM ranked_departments ranked
            WHERE component."department_id" = ranked."id"
              AND ranked.duplicate_rank > 1
        `);

        await queryRunner.query(`
            WITH ranked_departments AS (
                SELECT
                    "id",
                    FIRST_VALUE("id") OVER (
                        PARTITION BY LOWER(BTRIM("name"))
                        ORDER BY "created_at" ASC, "id" ASC
                    ) AS keeper_id,
                    ROW_NUMBER() OVER (
                        PARTITION BY LOWER(BTRIM("name"))
                        ORDER BY "created_at" ASC, "id" ASC
                    ) AS duplicate_rank
                FROM "departments"
            )
            UPDATE "component_drafts" draft
            SET "department_id" = ranked.keeper_id
            FROM ranked_departments ranked
            WHERE draft."department_id" = ranked."id"
              AND ranked.duplicate_rank > 1
        `);

        await queryRunner.query(`
            DELETE FROM "departments" department
            USING (
                SELECT "id"
                FROM (
                    SELECT
                        "id",
                        ROW_NUMBER() OVER (
                            PARTITION BY LOWER(BTRIM("name"))
                            ORDER BY "created_at" ASC, "id" ASC
                        ) AS duplicate_rank
                    FROM "departments"
                ) ranked
                WHERE ranked.duplicate_rank > 1
            ) duplicates
            WHERE department."id" = duplicates."id"
        `);

        await queryRunner.query(`
            WITH ranked_codes AS (
                SELECT
                    "id",
                    ROW_NUMBER() OVER (
                        PARTITION BY LOWER(BTRIM("code"))
                        ORDER BY "created_at" ASC, "id" ASC
                    ) AS duplicate_rank
                FROM "departments"
                WHERE "code" IS NOT NULL
                  AND BTRIM("code") <> ''
            )
            UPDATE "departments" department
            SET "code" = NULL,
                "updated_at" = NOW()
            FROM ranked_codes ranked
            WHERE department."id" = ranked."id"
              AND ranked.duplicate_rank > 1
        `);

        await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_component_relations_component_id" ON "component_relations" ("component_id")');
        await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_user_invite_short_links_expires_at" ON "user_invite_short_links" ("expires_at")');
        await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_departments_name" ON "departments" ("name")');
        await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_departments_code" ON "departments" ("code")');
        await queryRunner.query('CREATE UNIQUE INDEX IF NOT EXISTS "UQ_departments_name_normalized" ON "departments" (LOWER(BTRIM("name")))');
        await queryRunner.query('CREATE UNIQUE INDEX IF NOT EXISTS "UQ_departments_code_normalized" ON "departments" (LOWER(BTRIM("code"))) WHERE "code" IS NOT NULL AND BTRIM("code") <> \'\'');
        await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_components_department_id" ON "components" ("department_id")');
        await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_component_drafts_department_id" ON "component_drafts" ("department_id")');
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // Reconciliation of legacy production data is intentionally irreversible.
    }
}
