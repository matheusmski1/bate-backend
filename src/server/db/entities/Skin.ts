import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm'

export type SkinUnlockType = 'default' | 'earned' | 'paid'

@Entity({ name: 'skins' })
export class Skin {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string

  @Column({ type: 'varchar', length: 64 })
  name!: string

  @Column({ type: 'varchar', length: 16, default: 'default' })
  unlockType!: SkinUnlockType

  @Column({ type: 'int', default: 0 })
  priceCoins!: number

  @Column({ type: 'varchar', length: 255 })
  imagePath!: string

  @CreateDateColumn()
  createdAt!: Date
}
