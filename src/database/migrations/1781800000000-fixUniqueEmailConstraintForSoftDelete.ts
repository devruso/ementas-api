import { MigrationInterface, QueryRunner } from 'typeorm';

export class fixUniqueEmailConstraintForSoftDelete1781800000000 implements MigrationInterface {
    name = 'fixUniqueEmailConstraintForSoftDelete1781800000000';

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
        await queryRunner.query(
            'CREATE UNIQUE INDEX "UQ_users_email_not_deleted" ON "users" ("email") WHERE "is_deleted" = false'
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove o índice parcial
        await queryRunner.query('DROP INDEX "UQ_users_email_not_deleted"');

        // Restaura o constraint UNIQUE original (global)
        await queryRunner.query(
            'ALTER TABLE "users" ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email")'
        );
    }
}
