import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm'

export type DeckUnlockType = 'default' | 'earned' | 'paid'

@Entity({ name: 'decks' })
export class Deck {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string

  @Column({ type: 'varchar', length: 64 })
  name!: string

  @Column({ type: 'varchar', length: 16, default: 'default' })
  unlockType!: DeckUnlockType

  @Column({ type: 'int', default: 0 })
  priceCoins!: number

  @Column({ type: 'varchar', length: 255 })
  previewPath!: string

  @CreateDateColumn()
  createdAt!: Date
}
