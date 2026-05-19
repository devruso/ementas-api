import { MigrationInterface, QueryRunner } from 'typeorm';

export class addSignatureFileMetadataToUsers1778700000000 implements MigrationInterface {
    name = 'addSignatureFileMetadataToUsers1778700000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "users" ADD "signature_file_key" character varying');
        await queryRunner.query('ALTER TABLE "users" ADD "signature_file_provider" character varying');
        await queryRunner.query('ALTER TABLE "users" ADD "signature_file_content_type" character varying');
        await queryRunner.query('ALTER TABLE "users" ADD "signature_file_size" integer');
        await queryRunner.query('ALTER TABLE "users" ADD "signature_file_hash" character varying');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "users" DROP COLUMN "signature_file_hash"');
        await queryRunner.query('ALTER TABLE "users" DROP COLUMN "signature_file_size"');
        await queryRunner.query('ALTER TABLE "users" DROP COLUMN "signature_file_content_type"');
        await queryRunner.query('ALTER TABLE "users" DROP COLUMN "signature_file_provider"');
        await queryRunner.query('ALTER TABLE "users" DROP COLUMN "signature_file_key"');
    }
}
