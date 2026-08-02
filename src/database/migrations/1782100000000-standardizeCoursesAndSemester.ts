import { MigrationInterface, QueryRunner } from 'typeorm';

const COMPUTER_SCIENCE_BACHELOR = 'Bacharelado em Ci\u00eancia da Computa\u00e7\u00e3o';
const INFORMATION_SYSTEMS_BACHELOR = 'Bacharelado em Sistemas de Informa\u00e7\u00e3o';
const COMPUTING_TEACHING_DEGREE = 'Licenciatura em Computa\u00e7\u00e3o';
const PGCOMP = 'Programa de P\u00f3s-Gradua\u00e7\u00e3o em Ci\u00eancia da Computa\u00e7\u00e3o';
const PMCC = 'Programa de P\u00f3s-Gradua\u00e7\u00e3o em Mecatr\u00f4nica';

export class standardizeCoursesAndSemester1782100000000 implements MigrationInterface {
    name = 'standardizeCoursesAndSemester1782100000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        const courses = [
            COMPUTER_SCIENCE_BACHELOR,
            INFORMATION_SYSTEMS_BACHELOR,
            COMPUTING_TEACHING_DEGREE,
            PGCOMP,
            PMCC,
        ];

        for (const course of courses) {
            await queryRunner.query(
                `INSERT INTO "departments" ("name")
                 SELECT $1::varchar
                 WHERE NOT EXISTS (
                     SELECT 1 FROM "departments" d WHERE LOWER(TRIM(d."name")) = LOWER(TRIM($1::varchar))
                 )`,
                [ course ]
            );
        }

        const canonicalCourseCase = `
            CASE
                WHEN UPPER(TRIM("department")) IN (
                    'COLEGIADO DO CURSO DE GRADUA\u00c7\u00c3O EM CI\u00caNCIA DA COMPUTA\u00c7\u00c3O/IC',
                    'COLEGIADO DO CURSO DE GRADUACAO EM CIENCIA DA COMPUTACAO/IC'
                ) THEN '${COMPUTER_SCIENCE_BACHELOR}'
                WHEN UPPER(TRIM("department")) IN (
                    'COLEGIADO DO CURSO DE GRADUA\u00c7\u00c3O EM SISTEMAS DE INFORMA\u00c7\u00c3O/IC',
                    'COLEGIADO DO CURSO DE GRADUACAO EM SISTEMAS DE INFORMACAO/IC'
                ) THEN '${INFORMATION_SYSTEMS_BACHELOR}'
                WHEN UPPER(TRIM("department")) IN (
                    'COLEGIADO DO CURSO DE LICENCIATURA EM COMPUTA\u00c7\u00c3O/IC',
                    'COLEGIADO DO CURSO DE LICENCIATURA EM COMPUTACAO/IC'
                ) THEN '${COMPUTING_TEACHING_DEGREE}'
                WHEN UPPER(TRIM("department")) IN (
                    'PROGRAMA SIGAA',
                    'PGCOMP',
                    'PGCOMP/IC',
                    'PROGRAMA DE P\u00d3S-GRADUA\u00c7\u00c3O EM CI\u00caNCIA DA COMPUTA\u00c7\u00c3O',
                    'PROGRAMA DE POS-GRADUACAO EM CIENCIA DA COMPUTACAO',
                    'PROGRAMA DE P\u00d3S-GRADUA\u00c7\u00c3O EM CI\u00caNCIA DA COMPUTA\u00c7\u00c3O (PGCOMP)',
                    'PROGRAMA DE POS-GRADUACAO EM CIENCIA DA COMPUTACAO (PGCOMP)'
                ) THEN '${PGCOMP}'
                WHEN UPPER(TRIM("department")) IN (
                    'PMCC',
                    'PROGRAMA DE P\u00d3S-GRADUA\u00c7\u00c3O EM MECATR\u00d4NICA',
                    'PROGRAMA DE POS-GRADUACAO EM MECATRONICA',
                    'PROGRAMA DE P\u00d3S-GRADUA\u00c7\u00c3O EM MECATR\u00d4NICA (PMCC)',
                    'PROGRAMA DE POS-GRADUACAO EM MECATRONICA (PMCC)',
                    'PROGRAMA DE P\u00d3S-GRADUA\u00c7\u00c3O EM CI\u00caNCIA DA COMPUTA\u00c7\u00c3O (PMCC)',
                    'PROGRAMA DE POS-GRADUACAO EM CIENCIA DA COMPUTACAO (PMCC)',
                    'PROGRAMA MULTIDISCIPLINAR EM CI\u00caNCIA DA COMPUTA\u00c7\u00c3O',
                    'PROGRAMA MULTIDISCIPLINAR EM CIENCIA DA COMPUTACAO'
                ) THEN '${PMCC}'
                ELSE NULL
            END
        `;

        await queryRunner.query(`
            UPDATE "components" c
            SET "department" = mapped.course_name,
                "department_id" = d."id",
                "semester" = '2026.2'
            FROM (
                SELECT "id", ${canonicalCourseCase} AS course_name
                FROM "components"
            ) mapped
            LEFT JOIN "departments" d ON LOWER(TRIM(d."name")) = LOWER(TRIM(mapped.course_name))
            WHERE c."id" = mapped."id"
              AND mapped.course_name IS NOT NULL
        `);

        await queryRunner.query(`
            UPDATE "component_drafts" cd
            SET "department" = mapped.course_name,
                "department_id" = d."id",
                "semester" = '2026.2'
            FROM (
                SELECT "id", ${canonicalCourseCase} AS course_name
                FROM "component_drafts"
            ) mapped
            LEFT JOIN "departments" d ON LOWER(TRIM(d."name")) = LOWER(TRIM(mapped.course_name))
            WHERE cd."id" = mapped."id"
              AND mapped.course_name IS NOT NULL
        `);

        await queryRunner.query('UPDATE "components" SET "semester" = \'2026.2\'');
        await queryRunner.query('UPDATE "component_drafts" SET "semester" = \'2026.2\'');
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // Data standardization is intentionally not reversed.
    }
}
