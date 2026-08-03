import { MigrationInterface, QueryRunner } from 'typeorm';

export class deriveSemestersFromCurriculumContexts1782300000000 implements MigrationInterface {
    name = 'deriveSemestersFromCurriculumContexts1782300000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "components" c
            SET "semester" = ranked_contexts."implementation_semester"
            FROM (
                SELECT DISTINCT ON (ctx."component_id")
                    ctx."component_id",
                    ctx."implementation_semester"
                FROM "component_curriculum_contexts" ctx
                WHERE ctx."implementation_semester" ~ '^(19|20)[0-9]{2}\\.[12]$'
                ORDER BY
                    ctx."component_id",
                    ctx."is_active" DESC,
                    CAST(REPLACE(ctx."implementation_semester", '.', '') AS integer) DESC
            ) ranked_contexts
            WHERE c."id" = ranked_contexts."component_id"
              AND (
                  c."semester" IS NULL
                  OR TRIM(c."semester") = ''
                  OR c."semester" = '2026.2'
              )
        `);

        await queryRunner.query(`
            UPDATE "component_drafts" cd
            SET "semester" = c."semester"
            FROM "components" c
            WHERE cd."component_id" = c."id"
              AND c."semester" ~ '^(19|20)[0-9]{2}\\.[12]$'
              AND (
                  cd."semester" IS NULL
                  OR TRIM(cd."semester") = ''
                  OR cd."semester" = '2026.2'
              )
        `);
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // Derived semester repair is intentionally not reversed.
    }
}
