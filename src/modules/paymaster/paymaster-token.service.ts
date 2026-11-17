import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { getAddress, isAddress } from 'viem';
import { env } from 'src/config';

const PAYMASTER_TOKEN_PURPOSE = 'paymaster';
const PAYMASTER_TOKEN_CONTEXT = 'tap2stacks-paymaster-v1';
const PAYMASTER_TOKEN_TTL_SECONDS = 15 * 60;

export interface PaymasterTokenResult {
  token: string;
  expiresAt: number;
}

@Injectable()
export class PaymasterTokenService {
  private readonly derivedSecret: string;

  constructor() {
    this.derivedSecret = createHmac('sha256', env.secret.jwtSecret)
      .update(PAYMASTER_TOKEN_CONTEXT)
      .digest('hex');
  }

  issue(rawAddress?: string): PaymasterTokenResult {
    if (!rawAddress || !isAddress(rawAddress, { strict: false })) {
      throw new UnauthorizedException('Invalid authenticated wallet');
    }

    const address = getAddress(rawAddress);
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + PAYMASTER_TOKEN_TTL_SECONDS;
    const token = jwt.sign(
      {
        sub: address,
        purpose: PAYMASTER_TOKEN_PURPOSE,
        iat,
        exp,
      },
      this.derivedSecret,
      { algorithm: 'HS256' },
    );

    return {
      token,
      expiresAt: exp * 1000,
    };
  }

  verify(token?: string): string {
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Invalid or expired paymaster token');
    }

    try {
      const payload = jwt.verify(token, this.derivedSecret, {
        algorithms: ['HS256'],
      });
      if (
        !payload ||
        typeof payload !== 'object' ||
        payload.purpose !== PAYMASTER_TOKEN_PURPOSE ||
        typeof payload.sub !== 'string' ||
        !isAddress(payload.sub, { strict: false })
      ) {
        throw new Error('Invalid claims');
      }
      return getAddress(payload.sub);
    } catch {
      throw new UnauthorizedException('Invalid or expired paymaster token');
    }
  }
}
