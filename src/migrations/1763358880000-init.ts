import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1763358880000 implements MigrationInterface {
  name = 'Init1763358880000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TYPE "public"."ledger_entries_eventtype_enum" AS ENUM('FAUCET_FREE_TAP', 'DEPOSIT', 'WITHDRAW_REQUESTED', 'WITHDRAW_CANCELLED', 'WITHDRAW_SUCCEEDED', 'BET_PLACE', 'BET_SETTLE', 'REFUND', 'CORRECTION')`,
    );
    await queryRunner.query(
      `CREATE TABLE "ledger_entries" ("id" uuid NOT NULL, "userId" character varying NOT NULL, "eventType" "public"."ledger_entries_eventtype_enum" NOT NULL, "economicKey" character varying(255) NOT NULL, "deltas" jsonb NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_ledger_entries_economicKey" UNIQUE ("economicKey"), CONSTRAINT "PK_ledger_entries_id" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "ledger_snapshots" ("id" SERIAL NOT NULL, "userId" character varying NOT NULL, "ledgerSeq" uuid NOT NULL, "balanceAfter" jsonb NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_ledger_snapshots_userId_ledgerSeq" UNIQUE ("userId", "ledgerSeq"), CONSTRAINT "PK_ledger_snapshots_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ledger_snapshots_userId" ON "ledger_snapshots" ("userId")`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."orders_status_enum" AS ENUM('OPEN', 'SETTLED', 'REJECTED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "orders" ("orderId" character varying NOT NULL, "userId" character varying NOT NULL, "marketId" character varying NOT NULL, "cellTimeStart" bigint NOT NULL, "cellTimeEnd" bigint NOT NULL, "lowerPrice" numeric NOT NULL, "upperPrice" numeric NOT NULL, "amount" numeric NOT NULL, "rewardRate" numeric NOT NULL, "placedAt" bigint NOT NULL, "status" "public"."orders_status_enum" NOT NULL, "settledAt" bigint, "settledWin" boolean, "anchorBatchId" character varying, "anchorLeafHash" character varying, "anchoredAt" bigint, CONSTRAINT "PK_orders_orderId" PRIMARY KEY ("orderId"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "deposit_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "amount" numeric(20,0) NOT NULL, "txHash" character varying NOT NULL, "logIndex" integer NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_deposit_history_txHash_logIndex" UNIQUE ("txHash", "logIndex"), CONSTRAINT "PK_deposit_history_id" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "withdrawal_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sessionId" character varying NOT NULL, "userId" character varying NOT NULL, "amount" numeric(20,0) NOT NULL, "txHash" character varying NOT NULL, "logIndex" integer NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_withdrawal_history_txHash_logIndex" UNIQUE ("txHash", "logIndex"), CONSTRAINT "PK_withdrawal_history_id" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."withdrawal_sessions_status_enum" AS ENUM('OPEN', 'SUCCESS', 'EXPIRED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "withdrawal_sessions" ("sessionId" uuid NOT NULL, "userId" character varying NOT NULL, "amount" numeric(30,9) NOT NULL, "status" "public"."withdrawal_sessions_status_enum" NOT NULL DEFAULT 'OPEN', "txHash" text, "approvalSignature" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "expiresAt" TIMESTAMP NOT NULL, CONSTRAINT "PK_withdrawal_sessions_sessionId" PRIMARY KEY ("sessionId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_withdrawal_sessions_userId" ON "withdrawal_sessions" ("userId")`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."settlement_anchor_batches_status_enum" AS ENUM('PENDING', 'SUBMITTED', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "settlement_anchor_batches" ("batchId" character varying NOT NULL, "status" "public"."settlement_anchor_batches_status_enum" NOT NULL DEFAULT 'PENDING', "orderCount" integer NOT NULL, "topicId" character varying, "sequenceNumber" character varying, "consensusTimestamp" character varying, "runningHash" character varying, "merkleRoot" character varying NOT NULL, "payloadHash" character varying NOT NULL, "submittedPayload" text NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "submittedAt" TIMESTAMP, "errorMessage" text, CONSTRAINT "PK_settlement_anchor_batches_batchId" PRIMARY KEY ("batchId"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "settlement_anchor_batches"`);
    await queryRunner.query(
      `DROP TYPE "public"."settlement_anchor_batches_status_enum"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_withdrawal_sessions_userId"`,
    );
    await queryRunner.query(`DROP TABLE "withdrawal_sessions"`);
    await queryRunner.query(
      `DROP TYPE "public"."withdrawal_sessions_status_enum"`,
    );

    await queryRunner.query(`DROP TABLE "withdrawal_history"`);
    await queryRunner.query(`DROP TABLE "deposit_history"`);

    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP TYPE "public"."orders_status_enum"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_ledger_snapshots_userId"`);
    await queryRunner.query(`DROP TABLE "ledger_snapshots"`);

    await queryRunner.query(`DROP TABLE "ledger_entries"`);
    await queryRunner.query(
      `DROP TYPE "public"."ledger_entries_eventtype_enum"`,
    );
  }
}
