import type { MigrationInterface, QueryRunner } from 'typeorm'

export class InitSchema1748160000000 implements MigrationInterface {
  name = 'InitSchema1748160000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL,
        "displayName" varchar(32) NOT NULL DEFAULT '',
        "equippedSkin" varchar(64) NOT NULL DEFAULT 'default',
        "email" varchar(255),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "lastSeenAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_users_email" ON "users" ("email") WHERE "email" IS NOT NULL
    `)

    await queryRunner.query(`
      CREATE TABLE "skins" (
        "id" varchar(64) NOT NULL,
        "name" varchar(64) NOT NULL,
        "unlockType" varchar(16) NOT NULL DEFAULT 'default',
        "priceCoins" int NOT NULL DEFAULT 0,
        "imagePath" varchar(255) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_skins_id" PRIMARY KEY ("id")
      )
    `)

    await queryRunner.query(`
      CREATE TABLE "user_skins" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "skinId" varchar(64) NOT NULL,
        "acquiredVia" varchar(16) NOT NULL DEFAULT 'default',
        "acquiredAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_skins_id" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_user_skins_unique" ON "user_skins" ("userId", "skinId")
    `)

    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_skins_unique"`)
    await queryRunner.query(`DROP TABLE IF EXISTS "user_skins"`)
    await queryRunner.query(`DROP TABLE IF EXISTS "skins"`)
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_email"`)
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`)
  }
}
