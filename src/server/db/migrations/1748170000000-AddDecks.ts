import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddDecks1748170000000 implements MigrationInterface {
  name = 'AddDecks1748170000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "equippedDeck" varchar(64) NOT NULL DEFAULT 'default'`)

    await queryRunner.query(`
      CREATE TABLE "decks" (
        "id" varchar(64) NOT NULL,
        "name" varchar(64) NOT NULL,
        "unlockType" varchar(16) NOT NULL DEFAULT 'default',
        "priceCoins" int NOT NULL DEFAULT 0,
        "previewPath" varchar(255) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_decks_id" PRIMARY KEY ("id")
      )
    `)

    await queryRunner.query(`
      CREATE TABLE "user_decks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "deckId" varchar(64) NOT NULL,
        "acquiredVia" varchar(16) NOT NULL DEFAULT 'default',
        "acquiredAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_decks_id" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_user_decks_unique" ON "user_decks" ("userId", "deckId")`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_decks_unique"`)
    await queryRunner.query(`DROP TABLE IF EXISTS "user_decks"`)
    await queryRunner.query(`DROP TABLE IF EXISTS "decks"`)
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "equippedDeck"`)
  }
}
