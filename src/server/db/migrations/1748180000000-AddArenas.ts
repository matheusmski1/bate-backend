import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddArenas1748180000000 implements MigrationInterface {
  name = 'AddArenas1748180000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "equippedArena" varchar(64) NOT NULL DEFAULT 'default'`)

    await queryRunner.query(`
      CREATE TABLE "arenas" (
        "id" varchar(64) NOT NULL,
        "name" varchar(64) NOT NULL,
        "unlockType" varchar(16) NOT NULL DEFAULT 'default',
        "priceCoins" int NOT NULL DEFAULT 0,
        "previewPath" varchar(255) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_arenas_id" PRIMARY KEY ("id")
      )
    `)

    await queryRunner.query(`
      CREATE TABLE "user_arenas" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "arenaId" varchar(64) NOT NULL,
        "acquiredVia" varchar(16) NOT NULL DEFAULT 'default',
        "acquiredAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_arenas_id" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_user_arenas_unique" ON "user_arenas" ("userId", "arenaId")`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_arenas_unique"`)
    await queryRunner.query(`DROP TABLE IF EXISTS "user_arenas"`)
    await queryRunner.query(`DROP TABLE IF EXISTS "arenas"`)
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "equippedArena"`)
  }
}
