import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

export type SkinAcquisitionVia = 'default' | 'earned' | 'purchased'

@Entity({ name: 'user_skins' })
@Index(['userId', 'skinId'], { unique: true })
export class UserSkin {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column('uuid')
  userId!: string

  @Column({ type: 'varchar', length: 64 })
  skinId!: string

  @Column({ type: 'varchar', length: 16, default: 'default' })
  acquiredVia!: SkinAcquisitionVia

  @CreateDateColumn()
  acquiredAt!: Date
}
