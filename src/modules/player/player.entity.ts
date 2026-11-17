import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
@Entity('players')
export class Player {
  @PrimaryColumn() address: string;
  @Column({ type: 'timestamptz' }) age18At: Date;
  @Column({ type: 'timestamptz' }) notUSAt: Date;
  @Column({ default: false }) isBot: boolean;
  @Column({ type: 'varchar', length: 2, nullable: true }) countryAtSignup:
    | string
    | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
