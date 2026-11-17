import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPriceSamples1794921000000 implements MigrationInterface {
  name = 'AddPriceSamples1794921000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "price_samples" ("ticker" character varying NOT NULL, "tsMs" bigint NOT NULL, "price" numeric(20,6) NOT NULL, CONSTRAINT "PK_price_samples_ticker_tsMs" PRIMARY KEY ("ticker", "tsMs"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_price_samples_ticker_tsMs" ON "price_samples" ("ticker", "tsMs")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_price_samples_ticker_tsMs"`,
    );
    await queryRunner.query(`DROP TABLE "price_samples"`);
  }
}
