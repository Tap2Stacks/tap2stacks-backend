import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProofBatchesBase1795300000000 implements MigrationInterface {
  name = 'ProofBatchesBase1795300000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "settlement_anchor_batches"
        DROP COLUMN IF EXISTS "topicId",
        DROP COLUMN IF EXISTS "sequenceNumber",
        DROP COLUMN IF EXISTS "consensusTimestamp",
        DROP COLUMN IF EXISTS "runningHash",
        DROP COLUMN IF EXISTS "payloadHash",
        DROP COLUMN IF EXISTS "submittedPayload"`,
    );
    await q.query(
      `ALTER TABLE "settlement_anchor_batches" RENAME COLUMN "merkleRoot" TO "tapsRoot"`,
    );
    await q.query(
      `ALTER TABLE "settlement_anchor_batches" RENAME COLUMN "errorMessage" TO "lastError"`,
    );
    await q.query(
      `ALTER TABLE "settlement_anchor_batches"
        ADD COLUMN "index" integer,
        ADD COLUMN "fromMs" bigint NOT NULL DEFAULT 0,
        ADD COLUMN "toMs" bigint NOT NULL DEFAULT 0,
        ADD COLUMN "priceLogHash" character varying NOT NULL DEFAULT '',
        ADD COLUMN "txHash" character varying,
        ADD COLUMN "attempts" integer NOT NULL DEFAULT 0`,
    );
    await q.query(
      `ALTER TABLE "settlement_anchor_batches"
        ALTER COLUMN "fromMs" DROP DEFAULT,
        ALTER COLUMN "toMs" DROP DEFAULT,
        ALTER COLUMN "priceLogHash" DROP DEFAULT`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "IDX_settlement_anchor_batches_index" ON "settlement_anchor_batches" ("index") WHERE "index" IS NOT NULL`,
    );
    await q.query(
      `CREATE INDEX "IDX_settlement_anchor_batches_status_toMs" ON "settlement_anchor_batches" ("status", "toMs")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_orders_settledAt" ON "orders" ("settledAt")`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_orders_settledAt"`);
    await q.query(
      `DROP INDEX IF EXISTS "IDX_settlement_anchor_batches_status_toMs"`,
    );
    await q.query(`DROP INDEX IF EXISTS "IDX_settlement_anchor_batches_index"`);
    await q.query(
      `ALTER TABLE "settlement_anchor_batches"
        DROP COLUMN IF EXISTS "attempts",
        DROP COLUMN IF EXISTS "txHash",
        DROP COLUMN IF EXISTS "priceLogHash",
        DROP COLUMN IF EXISTS "toMs",
        DROP COLUMN IF EXISTS "fromMs",
        DROP COLUMN IF EXISTS "index"`,
    );
    await q.query(
      `ALTER TABLE "settlement_anchor_batches" RENAME COLUMN "lastError" TO "errorMessage"`,
    );
    await q.query(
      `ALTER TABLE "settlement_anchor_batches" RENAME COLUMN "tapsRoot" TO "merkleRoot"`,
    );
    await q.query(
      `ALTER TABLE "settlement_anchor_batches"
        ADD COLUMN "topicId" character varying,
        ADD COLUMN "sequenceNumber" character varying,
        ADD COLUMN "consensusTimestamp" character varying,
        ADD COLUMN "runningHash" character varying,
        ADD COLUMN "payloadHash" character varying NOT NULL DEFAULT '',
        ADD COLUMN "submittedPayload" text NOT NULL DEFAULT ''`,
    );
  }
}
