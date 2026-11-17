import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddPlayers1795200000000 implements MigrationInterface {
  name = 'AddPlayers1795200000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE "players" ("address" varchar PRIMARY KEY, "age18At" timestamptz NOT NULL, "notUSAt" timestamptz NOT NULL, "isBot" boolean NOT NULL DEFAULT false, "countryAtSignup" varchar(2), "createdAt" timestamptz NOT NULL DEFAULT now())`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE "players"');
  }
}
