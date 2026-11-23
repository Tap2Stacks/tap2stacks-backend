import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { getAddress } from 'ethers';
import { Repository } from 'typeorm';
import { env } from 'src/config';
import { Player } from './player.entity';
@Injectable()
export class PlayerService {
  constructor(
    @InjectRepository(Player) private readonly players: Repository<Player>,
  ) {}

  async assertTradingAttestation(rawAddress: string): Promise<void> {
    const address = getAddress(rawAddress);
    const player = await this.players.findOneBy({ address });
    if (!player?.age18At || !player.notUSAt) {
      throw new ForbiddenException({ error: 'ATTESTATION_REQUIRED' });
    }
  }

  async getOrCreate(
    rawAddress: string,
    age18?: boolean,
    notUS?: boolean,
    country: string | null = null,
  ): Promise<Player> {
    const address = getAddress(rawAddress);
    const existing = await this.players.findOneBy({ address });
    if (existing) return existing;
    if (age18 !== true || notUS !== true)
      throw new ForbiddenException({ error: 'ATTESTATION_REQUIRED' });
    const now = new Date();
    const player = this.players.create({
      address,
      age18At: now,
      notUSAt: now,
      countryAtSignup: country,
      isBot: env.botWallets.some(
        (bot) => bot.toLowerCase() === address.toLowerCase(),
      ),
    });
    try {
      return await this.players.save(player);
    } catch (error: any) {
      if (error.code !== '23505') throw error;
      const raced = await this.players.findOneBy({ address });
      if (!raced) throw error;
      return raced;
    }
  }
}
