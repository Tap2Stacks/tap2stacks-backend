import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class RunAnchorBatchDto {
  @ApiPropertyOptional({
    type: Number,
    description: 'Maximum number of settled orders to include in this batch',
    example: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxOrders?: number;

  @ApiPropertyOptional({
    type: String,
    description: 'Optional explicit batch ID for debugging/demo runs',
    example: 'anchor_demo_001',
  })
  @IsOptional()
  @IsString()
  batchId?: string;
}
