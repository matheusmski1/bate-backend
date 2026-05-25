import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

export type ArenaAcquisitionVia = 'default' | 'earned' | 'purchased'

@Entity({ name: 'user_arenas' })
@Index(['userId', 'arenaId'], { unique: true })
export class UserArena {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column('uuid')
  userId!: string

  @Column({ type: 'varchar', length: 64 })
  arenaId!: string

  @Column({ type: 'varchar', length: 16, default: 'default' })
  acquiredVia!: ArenaAcquisitionVia

  @CreateDateColumn()
  acquiredAt!: Date
}
