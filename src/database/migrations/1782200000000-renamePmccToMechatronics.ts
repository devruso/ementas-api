import { MigrationInterface, QueryRunner } from 'typeorm';

const PMCC = 'Programa de P\u00f3s-Gradua\u00e7\u00e3o em Mecatr\u00f4nica';
const OLD_PMCC = 'Programa Multidisciplinar em Ci\u00eancia da Computa\u00e7\u00e3o';

const legacyPmccNames = [
    OLD_PMCC,
    'PROGRAMA MULTIDISCIPLINAR EM CI\u00caNCIA DA COMPUTA\u00c7\u00c3O',
    'PROGRAMA MULTIDISCIPLINAR EM CIENCIA DA COMPUTACAO',
    'PROGRAMA DE P\u00d3S-GRADUA\u00c7\u00c3O EM CI\u00caNCIA DA COMPUTA\u00c7\u00c3O (PMCC)',
    'PROGRAMA DE POS-GRADUACAO EM CIENCIA DA COMPUTACAO (PMCC)',
    'PMCC',
];

export class renamePmccToMechatronics1782200000000 implements MigrationInterface {
    name = 'renamePmccToMechatronics1782200000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `INSERT INTO "departments" ("name")
             SELECT $1::varchar
             WHERE NOT EXISTS (
                 SELECT 1 FROM "departments" d WHERE LOWER(TRIM(d."name")) = LOWER(TRIM($1::varchar))
             )`,
            [ PMCC ]
        );

        await queryRunner.query(
            `UPDATE "components" c
             SET "department" = $1,
                 "department_id" = target_department."id"
             FROM "departments" target_department
             WHERE LOWER(TRIM(target_department."name")) = LOWER(TRIM($1))
               AND (
                   UPPER(TRIM(c."department")) = ANY($2::text[])
                   OR c."department_id" IN (
                       SELECT d."id"
                       FROM "departments" d
                       WHERE UPPER(TRIM(d."name")) = ANY($2::text[])
                   )
               )`,
            [ PMCC, legacyPmccNames.map((name) => name.toUpperCase()) ]
        );

        await queryRunner.query(
            `UPDATE "component_drafts" cd
             SET "department" = $1,
                 "department_id" = target_department."id"
             FROM "departments" target_department
             WHERE LOWER(TRIM(target_department."name")) = LOWER(TRIM($1))
               AND (
                   UPPER(TRIM(cd."department")) = ANY($2::text[])
                   OR cd."department_id" IN (
                       SELECT d."id"
                       FROM "departments" d
                       WHERE UPPER(TRIM(d."name")) = ANY($2::text[])
                   )
               )`,
            [ PMCC, legacyPmccNames.map((name) => name.toUpperCase()) ]
        );

        await queryRunner.query(
            `DELETE FROM "departments" d
             WHERE UPPER(TRIM(d."name")) = ANY($1::text[])
               AND NOT EXISTS (
                   SELECT 1 FROM "components" c WHERE c."department_id" = d."id"
               )
               AND NOT EXISTS (
                   SELECT 1 FROM "component_drafts" cd WHERE cd."department_id" = d."id"
               )`,
            [ legacyPmccNames.map((name) => name.toUpperCase()) ]
        );
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // Renaming institutional course labels is intentionally not reversed.
    }
}
