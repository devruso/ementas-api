import { MigrationInterface, QueryRunner } from 'typeorm';

export class addDepartmentsModule1780900000000 implements MigrationInterface {
    name = 'addDepartmentsModule1780900000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('CREATE TABLE "departments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "code" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT now(), CONSTRAINT "PK_departments_id" PRIMARY KEY ("id"))');
        await queryRunner.query('CREATE INDEX "IDX_departments_name" ON "departments" ("name")');
        await queryRunner.query('CREATE INDEX "IDX_departments_code" ON "departments" ("code")');
        await queryRunner.query('CREATE UNIQUE INDEX "UQ_departments_name_normalized" ON "departments" (LOWER(TRIM("name")))');
        await queryRunner.query("CREATE UNIQUE INDEX \"UQ_departments_code_normalized\" ON \"departments\" (LOWER(TRIM(\"code\"))) WHERE \"code\" IS NOT NULL AND TRIM(\"code\") <> ''");

        await queryRunner.query('ALTER TABLE "components" ADD "department_id" uuid');
        await queryRunner.query('ALTER TABLE "component_drafts" ADD "department_id" uuid');

        await queryRunner.query('CREATE INDEX "IDX_components_department_id" ON "components" ("department_id")');
        await queryRunner.query('CREATE INDEX "IDX_component_drafts_department_id" ON "component_drafts" ("department_id")');

        await queryRunner.query('ALTER TABLE "components" ADD CONSTRAINT "FK_components_department_id" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE NO ACTION');
        await queryRunner.query('ALTER TABLE "component_drafts" ADD CONSTRAINT "FK_component_drafts_department_id" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE NO ACTION');

        await queryRunner.query("INSERT INTO \"departments\" (\"name\") SELECT DISTINCT TRIM(\"department\") FROM \"components\" WHERE TRIM(\"department\") <> '' ON CONFLICT DO NOTHING");
        await queryRunner.query("INSERT INTO \"departments\" (\"name\") SELECT DISTINCT TRIM(\"department\") FROM \"component_drafts\" WHERE TRIM(\"department\") <> '' ON CONFLICT DO NOTHING");

        await queryRunner.query('UPDATE "components" SET "department_id" = d."id" FROM "departments" d WHERE "components"."department_id" IS NULL AND LOWER(TRIM("components"."department")) = LOWER(TRIM(d."name"))');
        await queryRunner.query('UPDATE "component_drafts" SET "department_id" = d."id" FROM "departments" d WHERE "component_drafts"."department_id" IS NULL AND LOWER(TRIM("component_drafts"."department")) = LOWER(TRIM(d."name"))');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('UPDATE "components" SET "department_id" = NULL');
        await queryRunner.query('UPDATE "component_drafts" SET "department_id" = NULL');

        await queryRunner.query('ALTER TABLE "component_drafts" DROP CONSTRAINT "FK_component_drafts_department_id"');
        await queryRunner.query('ALTER TABLE "components" DROP CONSTRAINT "FK_components_department_id"');

        await queryRunner.query('DROP INDEX "public"."IDX_component_drafts_department_id"');
        await queryRunner.query('DROP INDEX "public"."IDX_components_department_id"');

        await queryRunner.query('ALTER TABLE "component_drafts" DROP COLUMN "department_id"');
        await queryRunner.query('ALTER TABLE "components" DROP COLUMN "department_id"');

        await queryRunner.query('DROP INDEX "public"."UQ_departments_code_normalized"');
        await queryRunner.query('DROP INDEX "public"."UQ_departments_name_normalized"');
        await queryRunner.query('DROP INDEX "public"."IDX_departments_code"');
        await queryRunner.query('DROP INDEX "public"."IDX_departments_name"');
        await queryRunner.query('DROP TABLE "departments"');
    }
}