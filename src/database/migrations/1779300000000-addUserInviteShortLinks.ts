import { MigrationInterface, QueryRunner } from 'typeorm';

export class addUserInviteShortLinks1779300000000 implements MigrationInterface {
    name = 'addUserInviteShortLinks1779300000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('CREATE TABLE "user_invite_short_links" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "short_code" character varying NOT NULL, "invite_token" text NOT NULL, "recipient_email" character varying NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_user_invite_short_links_short_code" UNIQUE ("short_code"), CONSTRAINT "PK_user_invite_short_links_id" PRIMARY KEY ("id"))');
        await queryRunner.query('CREATE INDEX "IDX_user_invite_short_links_expires_at" ON "user_invite_short_links" ("expires_at")');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP INDEX "public"."IDX_user_invite_short_links_expires_at"');
        await queryRunner.query('DROP TABLE "user_invite_short_links"');
    }
}