import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

export type DeckAcquisitionVia = 'default' | 'earned' | 'purchased'

@Entity({ name: 'user_decks' })
@Index(['userId', 'deckId'], { unique: true })
export class UserDeck {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column('uuid')
  userId!: string

  @Column({ type: 'varchar', length: 64 })
  deckId!: string

  @Column({ type: 'varchar', length: 16, default: 'default' })
  acquiredVia!: DeckAcquisitionVia

  @CreateDateColumn()
  acquiredAt!: Date
}
