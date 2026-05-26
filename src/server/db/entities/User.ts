import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

@Entity({ name: 'users' })
export class User {
  @PrimaryColumn('uuid')
  id!: string

  @Column({ type: 'varchar', length: 32, default: '' })
  displayName!: string

  @Column({ type: 'varchar', length: 64, default: 'default' })
  equippedDeck!: string

  @Column({ type: 'varchar', length: 64, default: 'default' })
  equippedArena!: string

  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index({ unique: true, where: '"email" IS NOT NULL' })
  email!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  lastSeenAt!: Date
}
