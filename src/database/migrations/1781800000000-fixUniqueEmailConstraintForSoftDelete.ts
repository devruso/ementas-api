import { MigrationInterface, QueryRunner } from 'typeorm';

export class fixUniqueEmailConstraintForSoftDelete1781800000000 implements MigrationInterface {
    name = 'fixUniqueEmailConstraintForSoftDelete1781800000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Remove o constraint UNIQUE global que bloqueia soft delete
        await queryRunner.query('ALTER TABLE "users" DROP CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3"');

        // Cria índice UNIQUE parcial: permite email duplicado se is_deleted=true
        // Isso permite reutilização de email após soft delete
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
