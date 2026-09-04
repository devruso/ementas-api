import { MigrationInterface, QueryRunner } from 'typeorm';

export class addCoursesModule1782800000000 implements MigrationInterface {
    name = 'addCoursesModule1782800000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('CREATE TABLE "courses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "code" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT now(), CONSTRAINT "PK_courses_id" PRIMARY KEY ("id"))');
        await queryRunner.query('CREATE INDEX "IDX_courses_name" ON "courses" ("name")');
        await queryRunner.query('CREATE INDEX "IDX_courses_code" ON "courses" ("code")');
        await queryRunner.query('CREATE UNIQUE INDEX "UQ_courses_name_normalized" ON "courses" (LOWER(TRIM("name")))');
        await queryRunner.query("CREATE UNIQUE INDEX \"UQ_courses_code_normalized\" ON \"courses\" (LOWER(TRIM(\"code\"))) WHERE \"code\" IS NOT NULL AND TRIM(\"code\") <> ''");

        await queryRunner.query('ALTER TABLE "components" ADD "course_id" uuid');
        await queryRunner.query('ALTER TABLE "component_drafts" ADD "course_id" uuid');
        await queryRunner.query('CREATE INDEX "IDX_components_course_id" ON "components" ("course_id")');
        await queryRunner.query('CREATE INDEX "IDX_component_drafts_course_id" ON "component_drafts" ("course_id")');
        await queryRunner.query('ALTER TABLE "components" ADD CONSTRAINT "FK_components_course_id" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE NO ACTION');
        await queryRunner.query('ALTER TABLE "component_drafts" ADD CONSTRAINT "FK_component_drafts_course_id" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE NO ACTION');

        await queryRunner.query("INSERT INTO \"courses\" (\"name\", \"code\") SELECT DISTINCT ON (LOWER(TRIM(d.\"name\"))) TRIM(d.\"name\"), NULLIF(TRIM(d.\"code\"), '') FROM \"departments\" d WHERE TRIM(d.\"name\") <> '' AND (EXISTS (SELECT 1 FROM \"components\" c WHERE c.\"department_id\" = d.\"id\") OR EXISTS (SELECT 1 FROM \"component_drafts\" cd WHERE cd.\"department_id\" = d.\"id\")) ORDER BY LOWER(TRIM(d.\"name\")), d.\"created_at\" ASC ON CONFLICT DO NOTHING");
        await queryRunner.query("INSERT INTO \"courses\" (\"name\") SELECT DISTINCT TRIM(c.\"department\") FROM \"components\" c WHERE TRIM(c.\"department\") <> '' ON CONFLICT DO NOTHING");
        await queryRunner.query("INSERT INTO \"courses\" (\"name\") SELECT DISTINCT TRIM(cd.\"department\") FROM \"component_drafts\" cd WHERE TRIM(cd.\"department\") <> '' ON CONFLICT DO NOTHING");
        await queryRunner.query('UPDATE "components" c SET "course_id" = course."id" FROM "courses" course WHERE LOWER(TRIM(c."department")) = LOWER(TRIM(course."name"))');
        await queryRunner.query('UPDATE "component_drafts" cd SET "course_id" = course."id" FROM "courses" course WHERE LOWER(TRIM(cd."department")) = LOWER(TRIM(course."name"))');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "component_drafts" DROP CONSTRAINT "FK_component_drafts_course_id"');
        await queryRunner.query('ALTER TABLE "components" DROP CONSTRAINT "FK_components_course_id"');
        await queryRunner.query('DROP INDEX "public"."IDX_component_drafts_course_id"');
        await queryRunner.query('DROP INDEX "public"."IDX_components_course_id"');
        await queryRunner.query('ALTER TABLE "component_drafts" DROP COLUMN "course_id"');
        await queryRunner.query('ALTER TABLE "components" DROP COLUMN "course_id"');
        await queryRunner.query('DROP TABLE "courses"');
    }
}
