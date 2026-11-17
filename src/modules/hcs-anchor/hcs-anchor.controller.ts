import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { HcsAnchorService } from './hcs-anchor.service';
import { GetAnchorBatchesDto } from './dto/get-anchor-batches.dto';
import { RunAnchorBatchDto } from './dto/run-anchor-batch.dto';

@ApiTags('HCS Anchor')
@Controller('v1/hcs-anchor')
export class HcsAnchorController {
  constructor(private readonly hcsAnchorService: HcsAnchorService) {}

  @Post('run')
  @ApiBearerAuth('bearer')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Run one anchor batch for settled orders',
    description:
      'Queries settled orders that are not anchored yet, builds a Merkle batch, and submits it through the configured HCS publisher.',
  })
  async runAnchor(@Body() dto: RunAnchorBatchDto) {
    return this.hcsAnchorService.runOnce(dto);
  }

  @Get('batches')
  @ApiOperation({
    summary: 'List anchor batches',
  })
  async getBatches(@Query() query: GetAnchorBatchesDto) {
    return this.hcsAnchorService.getBatches(query.limit, query.offset);
  }

  @Get('batches/:batchId')
  @ApiOperation({
    summary: 'Get anchor batch details',
  })
  async getBatch(@Param('batchId') batchId: string) {
    return this.hcsAnchorService.getBatch(batchId);
  }

  @Get('batches/:batchId/verify-topic')
  @ApiOperation({
    summary: 'Verify an anchor batch against the configured publisher',
  })
  async verifyBatchTopic(@Param('batchId') batchId: string) {
    return this.hcsAnchorService.verifyBatchTopic(batchId);
  }

  @Get('orders/:orderId/proof')
  @ApiOperation({
    summary: 'Get Merkle proof for an anchored order',
  })
  async getOrderProof(@Param('orderId') orderId: string) {
    return this.hcsAnchorService.getOrderProof(orderId);
  }
}
