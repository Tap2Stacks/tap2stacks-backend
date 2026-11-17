import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PublicRateLimitGuard } from '../feed/public-rate-limit.guard';
import { ProofService } from './proof.service';

@ApiTags('Proofs')
@Controller('proofs')
@UseGuards(PublicRateLimitGuard)
export class ProofController {
  constructor(private readonly proofService: ProofService) {}

  @Get()
  @ApiOperation({ summary: 'List submitted Base Sepolia proof batches' })
  async getProofs(
    @Query('limit') rawLimit?: string,
    @Query('offset') rawOffset?: string,
  ) {
    const limit = this.parseLimit(rawLimit);
    const offset = this.parseOffset(rawOffset);
    return this.proofService.listSubmittedBatches(limit, offset);
  }

  @Get(':index/price-log')
  @ApiOperation({ summary: 'Download exact hashed NDJSON price log for batch' })
  async getPriceLog(
    @Param('index') rawIndex: string,
    @Res() res: Response,
  ): Promise<void> {
    const index = this.parseIndex(rawIndex);
    const buffer = await this.proofService.getBatchPriceLog(index);
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.status(200).send(buffer);
  }

  @Get(':index/taps')
  @ApiOperation({ summary: 'Get settled taps and Merkle proofs for a batch' })
  async getBatchTaps(@Param('index') rawIndex: string) {
    const index = this.parseIndex(rawIndex);
    return this.proofService.getBatchTaps(index);
  }

  private parseIndex(raw: string): number {
    if (!/^\d+$/.test(raw)) {
      throw new BadRequestException('Invalid proof index');
    }
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed)) {
      throw new BadRequestException('Invalid proof index');
    }
    return parsed;
  }

  private parseLimit(raw?: string): number {
    if (raw === undefined || raw === '') {
      return 20;
    }
    if (!/^\d+$/.test(raw)) {
      throw new BadRequestException('Invalid limit');
    }
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new BadRequestException('Invalid limit');
    }
    return Math.min(50, parsed);
  }

  private parseOffset(raw?: string): number {
    if (raw === undefined || raw === '') {
      return 0;
    }
    if (!/^\d+$/.test(raw)) {
      throw new BadRequestException('Invalid offset');
    }
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed)) {
      throw new BadRequestException('Invalid offset');
    }
    return parsed;
  }
}
