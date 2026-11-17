import { Allow, IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { Cell } from 'src/libs/cell';
import { ApiProperty } from '@nestjs/swagger';

export class PlaceOrderDto {
    @ApiProperty({ type: Cell })
    @Type(() => Cell)
    cell: Cell;

    @ApiProperty({ type: String })
    @IsNotEmpty()
    @IsString()
    marketId: string;

    @ApiProperty({ type: String })
    @IsNotEmpty()
    @Type(() => String)
    @IsString()
    amount: string;

    @ApiProperty({ type: String, required: false })
    @IsOptional()
    @Allow()
    clientTapId?: string;
}
