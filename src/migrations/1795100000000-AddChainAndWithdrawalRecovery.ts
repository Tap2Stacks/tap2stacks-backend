import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddChainAndWithdrawalRecovery1795100000000 implements MigrationInterface {
  name = 'AddChainAndWithdrawalRecovery1795100000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE "chain_cursor" ("id" varchar PRIMARY KEY, "block" integer NOT NULL, "timestamp" integer NOT NULL)`,
    );
    await q.query(`ALTER TABLE "withdrawal_sessions" ADD "nonce" text`);
    await q.query(
      `ALTER TYPE "withdrawal_sessions_status_enum" RENAME TO "withdrawal_sessions_status_enum_old"`,
    );
    await q.query(
      `CREATE TYPE "withdrawal_sessions_status_enum" AS ENUM ('PENDING','OPEN','FAILED','SUCCESS','EXPIRED')`,
    );
    await q.query(
      `ALTER TABLE "withdrawal_sessions" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await q.query(
      `ALTER TABLE "withdrawal_sessions" ALTER COLUMN "status" TYPE "withdrawal_sessions_status_enum" USING "status"::text::"withdrawal_sessions_status_enum"`,
    );
    await q.query(
      `ALTER TABLE "withdrawal_sessions" ALTER COLUMN "status" SET DEFAULT 'OPEN'`,
    );
    await q.query(`DROP TYPE "withdrawal_sessions_status_enum_old"`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_active_withdrawal_player" ON "withdrawal_sessions" (lower("userId")) WHERE "status" IN ('OPEN', 'PENDING')`,
    );
    await q.query(
      `ALTER TABLE "deposit_history" ALTER COLUMN "amount" TYPE numeric(30,6)`,
    );
    await q.query(
      `ALTER TABLE "withdrawal_history" ALTER COLUMN "amount" TYPE numeric(30,6)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "UQ_active_withdrawal_player"`);
    await q.query(`ALTER TABLE "withdrawal_sessions" DROP COLUMN "nonce"`);
    await q.query(`DROP TABLE "chain_cursor"`);
    await q.query(
      `UPDATE "withdrawal_sessions" SET "status"='EXPIRED' WHERE "status" IN ('PENDING','FAILED')`,
    );
    await q.query(
      `ALTER TYPE "withdrawal_sessions_status_enum" RENAME TO "withdrawal_sessions_status_enum_new"`,
    );
    await q.query(
      `CREATE TYPE "withdrawal_sessions_status_enum" AS ENUM ('OPEN','SUCCESS','EXPIRED')`,
    );
    await q.query(
      `ALTER TABLE "withdrawal_sessions" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await q.query(
      `ALTER TABLE "withdrawal_sessions" ALTER COLUMN "status" TYPE "withdrawal_sessions_status_enum" USING "status"::text::"withdrawal_sessions_status_enum"`,
    );
    await q.query(
      `ALTER TABLE "withdrawal_sessions" ALTER COLUMN "status" SET DEFAULT 'OPEN'`,
    );
    await q.query(`DROP TYPE "withdrawal_sessions_status_enum_new"`);
    await q.query(
      `ALTER TABLE "deposit_history" ALTER COLUMN "amount" TYPE numeric(20,0)`,
    );
    await q.query(
      `ALTER TABLE "withdrawal_history" ALTER COLUMN "amount" TYPE numeric(20,0)`,
    );
  }
}
