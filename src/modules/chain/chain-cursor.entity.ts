import { Column, Entity, PrimaryColumn } from 'typeorm';
@Entity('chain_cursor')
export class ChainCursor {
  @PrimaryColumn() id: string;
  @Column('integer') block: number;
  @Column('integer') timestamp: number;
}
