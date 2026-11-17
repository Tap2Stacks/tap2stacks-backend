import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { HcsPublisher } from './hcs-publisher';
import {
  SubmitAnchorMessageInput,
  SubmitAnchorMessageResult,
  VerifyAnchorMessageInput,
  VerifyAnchorMessageResult,
} from '../types';

@Injectable()
export class MockHcsPublisher implements HcsPublisher {
  private readonly submissions = new Map<string, { payload: string }>();

  async submitAnchorMessage(
    input: SubmitAnchorMessageInput,
  ): Promise<SubmitAnchorMessageResult> {
    const consensusTimestamp = new Date().toISOString();
    const sequenceNumber = Date.now().toString();
    const runningHash = `0x${createHash('sha256')
      .update(`${input.batchId}:${input.payload}:${consensusTimestamp}`)
      .digest('hex')}`;

    const result = {
      topicId: '0.0.mock',
      sequenceNumber,
      consensusTimestamp,
      runningHash,
    };

    this.submissions.set(`${result.topicId}:${result.sequenceNumber}`, {
      payload: input.payload,
    });

    return result;
  }

  async verifyAnchorMessage(
    input: VerifyAnchorMessageInput,
  ): Promise<VerifyAnchorMessageResult> {
    const stored = this.submissions.get(
      `${input.topicId}:${input.sequenceNumber}`,
    );

    if (!stored) {
      return {
        found: false,
        topicId: input.topicId,
        sequenceNumber: input.sequenceNumber,
      };
    }

    return {
      found: true,
      topicId: input.topicId,
      sequenceNumber: input.sequenceNumber,
      consensusTimestamp: new Date().toISOString(),
      runningHash: `0x${createHash('sha256')
        .update(`${input.topicId}:${input.sequenceNumber}:${stored.payload}`)
        .digest('hex')}`,
      message: stored.payload,
      payloadMatches:
        input.expectedPayload == null || input.expectedPayload === stored.payload,
    };
  }
}
