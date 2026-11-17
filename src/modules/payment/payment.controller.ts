import { BadRequestException, Controller, Post, Body, Get, Query, UseGuards } from '@nestjs/common';
import BigNumber from 'bignumber.js';
import { uuidv7 } from 'uuidv7';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GetDepositsDto } from './dto/get-deposits.dto';
import { GetWithdrawalsDto } from './dto/get-withdrawals.dto';
import { ExpireTimeoutDto } from './dto/expire-timeout.dto';
import { DevFaucetGuard } from './guards/dev-faucet.guard';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

class DepositDto {
    @ApiProperty({ type: Number, minimum: 1, maximum: 1000 })
    @IsDefined()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @Max(1000)
    amount: number;

    @ApiProperty({ type: String, required: false })
    @IsOptional()
    @IsString()
    txHash?: string;

    @ApiProperty({ type: Number, required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    logIndex?: number;
}

class WithdrawRequestDto {
    @ApiProperty({ type: String })
    @IsString()
    amount: string;
}

class FinalizeWithdrawalDto {
    @ApiProperty({ type: String })
    @IsString()
    sessionId: string;
    @ApiProperty({ type: String })
    @IsString()
    txHash: string;
    @ApiProperty({ type: Number })
    @IsNumber()
    logIndex: number;
}

@ApiBearerAuth()
@ApiTags('payment')
@Controller('payment')
export class PaymentController {
    constructor(private readonly paymentService: PaymentService) { }

    @Post('withdraw')
    @UseGuards(JwtAuthGuard)
    async requestWithdrawal(@CurrentUser() user: { address: string }, @Body() dto: WithdrawRequestDto) {
        return this.paymentService.requestWithdrawal(user.address, dto.amount);
    }

    // --- Debug Endpoints ---

    @Post('debug/deposit')
    @UseGuards(DevFaucetGuard, JwtAuthGuard)
    async debugDeposit(@CurrentUser() user: { address: string }, @Body() dto: DepositDto) {
        const rawAmount = dto?.amount as unknown;
        const amountBn =
            typeof rawAmount === 'number' || typeof rawAmount === 'string'
                ? new BigNumber(typeof rawAmount === 'string' ? rawAmount.trim() : rawAmount)
                : new BigNumber(NaN);
        if (
            (typeof rawAmount === 'string' && rawAmount.trim() === '') ||
            !amountBn.isFinite() ||
            amountBn.lt(1) ||
            amountBn.gt(1000)
        ) {
            throw new BadRequestException('Amount must be between 1 and 1000');
        }
        const txHash = dto?.txHash ?? `debug:${uuidv7()}`;
        const logIndex = dto?.logIndex ?? 0;
        return this.paymentService.handleDeposit(user.address, amountBn.toString(), txHash, logIndex);
    }

    @Post('debug/finalize-withdrawal')
    @UseGuards(JwtAuthGuard)
    async debugFinalizeWithdrawal(@CurrentUser() user: { address: string }, @Body() dto: FinalizeWithdrawalDto) {
        return this.paymentService.finalizeWithdrawal(dto.sessionId, dto.txHash, dto.logIndex);
    }

    @Post('debug/expire-timeout')
    @UseGuards(JwtAuthGuard)
    async debugExpireTimeout(@CurrentUser() user: { address: string }, @Body() dto: ExpireTimeoutDto) {
        return this.paymentService.expireWithdrawal(dto.sessionId);
    }

    @Get('deposits')
    @UseGuards(JwtAuthGuard)
    async getUserDeposits(
        @CurrentUser() user: { address: string },
        @Query() query: GetDepositsDto,
    ) {
        return this.paymentService.getUserDeposits(user.address, query.limit, query.offset);
    }

    @Get('withdrawal/session')
    @UseGuards(JwtAuthGuard)
    async getActiveWithdrawalSession(@CurrentUser() user: { address: string }) {
        return this.paymentService.getActiveWithdrawalSession(user.address);
    }

    @Get('withdrawals')
    @UseGuards(JwtAuthGuard)
    async getUserWithdrawals(
        @CurrentUser() user: { address: string },
        @Query() query: GetWithdrawalsDto,
    ) {
        return this.paymentService.getUserWithdrawals(user.address, query.status, query.limit, query.offset);
    }
}
