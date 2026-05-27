import type { MigrationInterface, QueryRunner } from 'typeorm'

export class RemoveSkins1779470000000 implements MigrationInterface {
  name = 'RemoveSkins1779470000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_skins_unique"`)
    await queryRunner.query(`DROP TABLE IF EXISTS "user_skins"`)
    await queryRunner.query(`DROP TABLE IF EXISTS "skins"`)
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "equippedSkin"`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    throw new Error('RemoveSkins migration is not reversible — restore from snapshot to roll back')
  }
}
