import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderTickerAndVoidedStatus1795000000000
  implements MigrationInterface
{
  name = 'AddOrderTickerAndVoidedStatus1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."orders_status_enum" ADD VALUE IF NOT EXISTS 'VOIDED'`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ticker" character varying NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `UPDATE "orders" SET "ticker" = "marketId" WHERE "ticker" = ''`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN IF EXISTS "ticker"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."orders_status_enum" RENAME TO "orders_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."orders_status_enum" AS ENUM('OPEN', 'SETTLED', 'REJECTED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ALTER COLUMN "status" TYPE "public"."orders_status_enum" USING "status"::text::"public"."orders_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."orders_status_enum_old"`,
    );
  }
}
