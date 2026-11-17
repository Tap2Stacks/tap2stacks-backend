import { Column, Entity, PrimaryColumn } from 'typeorm';
import { BigIntMsTransformer } from 'src/libs/transformers';

@Entity('price_samples')
export class PriceSample {
    @PrimaryColumn({ type: 'character varying' })
    ticker: string;

    @PrimaryColumn({
        type: 'bigint',
        transformer: BigIntMsTransformer,
    })
    tsMs: number;

    @Column({ type: 'numeric', precision: 20, scale: 6 })
    price: string;
}
