import { MigrationInterface, QueryRunner } from 'typeorm';

export class backfillComponentDepartments1782000000000 implements MigrationInterface {
    name = 'backfillComponentDepartments1782000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            INSERT INTO "departments" ("name")
            SELECT DISTINCT normalized_department
            FROM (
                SELECT TRIM("department") AS normalized_department
                FROM "components"
                WHERE TRIM(COALESCE("department", '')) <> ''
                UNION
                SELECT TRIM("department") AS normalized_department
                FROM "component_drafts"
                WHERE TRIM(COALESCE("department", '')) <> ''
            ) source_departments
            WHERE NOT EXISTS (
                SELECT 1
                FROM "departments" d
                WHERE LOWER(TRIM(d."name")) = LOWER(TRIM(source_departments.normalized_department))
            )
        `);

        await queryRunner.query(`
            UPDATE "components" c
            SET "department_id" = d."id",
                "department" = d."name"
            FROM "departments" d
            WHERE TRIM(COALESCE(c."department", '')) <> ''
              AND LOWER(TRIM(c."department")) = LOWER(TRIM(d."name"))
        `);

        await queryRunner.query(`
            UPDATE "component_drafts" cd
            SET "department_id" = d."id",
                "department" = d."name"
            FROM "departments" d
            WHERE TRIM(COALESCE(cd."department", '')) <> ''
              AND LOWER(TRIM(cd."department")) = LOWER(TRIM(d."name"))
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "component_drafts"
            SET "department_id" = NULL
            WHERE "department_id" IS NOT NULL
        `);

        await queryRunner.query(`
            UPDATE "components"
            SET "department_id" = NULL
            WHERE "department_id" IS NOT NULL
        `);
    }
}
