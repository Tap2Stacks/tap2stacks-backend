import { Injectable } from '@nestjs/common';
import { env } from 'src/config';
import { HcsPublisher } from './hcs-publisher';
import {
  SubmitAnchorMessageInput,
  SubmitAnchorMessageResult,
  VerifyAnchorMessageInput,
  VerifyAnchorMessageResult,
} from '../types';

@Injectable()
export class LegacyHcsPublisher implements HcsPublisher {
  private cachedTopicId?: string;

  async submitAnchorMessage(
    input: SubmitAnchorMessageInput,
  ): Promise<SubmitAnchorMessageResult> {
    const {
      Client,
      TopicId,
      TopicCreateTransaction,
      TopicMessageSubmitTransaction,
      PrivateKey,
      AccountId,
    } = this.getSdk();
    const client = this.buildClient({
      Client,
      PrivateKey,
      AccountId,
    });

    try {
      const topicId = await this.resolveTopicId(client, {
        TopicCreateTransaction,
      });
      const tx = await new TopicMessageSubmitTransaction()
        .setTopicId(TopicId.fromString(topicId))
        .setMessage(input.payload)
        .execute(client);

      const receipt = await tx.getReceipt(client);

      return {
        topicId,
        sequenceNumber: String(receipt.topicSequenceNumber),
        consensusTimestamp: new Date().toISOString(),
        runningHash: Buffer.from(receipt.topicRunningHash).toString('base64'),
      };
    } finally {
      client.close();
    }
  }

  async verifyAnchorMessage(
    input: VerifyAnchorMessageInput,
  ): Promise<VerifyAnchorMessageResult> {
    const response = await fetch(
      `${env.hcs.legacy.mirrorNodeUrl}/api/v1/topics/${input.topicId}/messages/${input.sequenceNumber}`,
    );

    if (response.status === 404) {
      return {
        found: false,
        topicId: input.topicId,
        sequenceNumber: input.sequenceNumber,
      };
    }

    if (!response.ok) {
      throw new Error(
        `Mirror node verification failed with status ${response.status}`,
      );
    }

    const body = await response.json();
    const message =
      typeof body.message === 'string'
        ? Buffer.from(body.message, 'base64').toString('utf8')
        : undefined;

    return {
      found: true,
      topicId: body.topic_id ?? input.topicId,
      sequenceNumber: String(body.sequence_number ?? input.sequenceNumber),
      consensusTimestamp: body.consensus_timestamp,
      runningHash: body.running_hash,
      message,
      payloadMatches:
        input.expectedPayload == null || input.expectedPayload === message,
    };
  }

  private getSdk() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@legacy/sdk');
  }

  private buildClient(sdk: {
    Client: {
      forMainnet(): any;
      forPreviewnet(): any;
      forTestnet(): any;
    };
    PrivateKey: {
      fromString(value: string): any;
    };
    AccountId: {
      fromString(value: string): any;
    };
  }) {
    if (!env.hcs.legacy.operatorId || !env.hcs.legacy.operatorKey) {
      throw new Error(
        'Legacy operator config is missing. Set LEGACY_OPERATOR_ID and LEGACY_OPERATOR_KEY.',
      );
    }

    const client =
      env.hcs.legacy.network === 'mainnet'
        ? sdk.Client.forMainnet()
        : env.hcs.legacy.network === 'previewnet'
          ? sdk.Client.forPreviewnet()
          : sdk.Client.forTestnet();

    client.setOperator(
      sdk.AccountId.fromString(env.hcs.legacy.operatorId),
      sdk.PrivateKey.fromString(env.hcs.legacy.operatorKey),
    );

    return client;
  }

  private async resolveTopicId(
    client: any,
    sdk: {
      TopicCreateTransaction: new () => {
        setTopicMemo(value: string): any;
        execute(client: any): Promise<any>;
      };
    },
  ): Promise<string> {
    if (this.cachedTopicId) {
      return this.cachedTopicId;
    }

    if (env.hcs.topicId) {
      this.cachedTopicId = env.hcs.topicId;
      return this.cachedTopicId;
    }

    if (!env.hcs.createTopicIfMissing) {
      throw new Error(
        'HCS topic is missing. Set HCS_TOPIC_ID or enable HCS_CREATE_TOPIC_IF_MISSING=true.',
      );
    }

    const tx = await new sdk.TopicCreateTransaction()
      .setTopicMemo(env.hcs.topicMemo)
      .execute(client);
    const receipt = await tx.getReceipt(client);

    if (!receipt.topicId) {
      throw new Error('Legacy topic creation did not return a topic ID');
    }

    this.cachedTopicId = receipt.topicId.toString();
    return this.cachedTopicId;
  }
}
