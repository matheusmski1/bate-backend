import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm'

export type ArenaUnlockType = 'default' | 'earned' | 'paid'

@Entity({ name: 'arenas' })
export class Arena {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string

  @Column({ type: 'varchar', length: 64 })
  name!: string

  @Column({ type: 'varchar', length: 16, default: 'default' })
  unlockType!: ArenaUnlockType

  @Column({ type: 'int', default: 0 })
  priceCoins!: number

  @Column({ type: 'varchar', length: 255 })
  previewPath!: string

  @CreateDateColumn()
  createdAt!: Date
}
