import { MigrationInterface, QueryRunner } from 'typeorm';

export class snapshotApprovalSignatures1782900000000 implements MigrationInterface {
    name = 'snapshotApprovalSignatures1782900000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "component_logs" ADD "signature_file_key" character varying');
        await queryRunner.query('ALTER TABLE "component_logs" ADD "signature_file_provider" character varying');
        await queryRunner.query('ALTER TABLE "component_logs" ADD "signature_file_content_type" character varying');
        await queryRunner.query('ALTER TABLE "component_logs" ADD "signature_file_size" integer');
        await queryRunner.query('ALTER TABLE "component_logs" ADD "signature_file_hash" character varying');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "component_logs" DROP COLUMN "signature_file_hash"');
        await queryRunner.query('ALTER TABLE "component_logs" DROP COLUMN "signature_file_size"');
        await queryRunner.query('ALTER TABLE "component_logs" DROP COLUMN "signature_file_content_type"');
        await queryRunner.query('ALTER TABLE "component_logs" DROP COLUMN "signature_file_provider"');
        await queryRunner.query('ALTER TABLE "component_logs" DROP COLUMN "signature_file_key"');
    }
}
