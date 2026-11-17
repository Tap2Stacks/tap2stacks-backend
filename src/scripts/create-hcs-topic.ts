import { AccountId, Client, PrivateKey, TopicCreateTransaction } from '@legacy/sdk';
import { env } from 'src/config';

function buildClient(): Client {
  if (!env.hcs.legacy.operatorId || !env.hcs.legacy.operatorKey) {
    throw new Error(
      'Missing Legacy operator credentials. Set LEGACY_OPERATOR_ID and LEGACY_OPERATOR_KEY in .env.',
    );
  }

  const client =
    env.hcs.legacy.network === 'mainnet'
      ? Client.forMainnet()
      : env.hcs.legacy.network === 'previewnet'
        ? Client.forPreviewnet()
        : Client.forTestnet();

  client.setOperator(
    AccountId.fromString(env.hcs.legacy.operatorId),
    PrivateKey.fromString(env.hcs.legacy.operatorKey),
  );

  return client;
}

async function run() {
  const client = buildClient();

  try {
    const tx = await new TopicCreateTransaction()
      .setTopicMemo(env.hcs.topicMemo)
      .execute(client);

    const receipt = await tx.getReceipt(client);

    if (!receipt.topicId) {
      throw new Error('Topic creation did not return a topic ID');
    }

    const topicId = receipt.topicId.toString();

    console.log(
      JSON.stringify(
        {
          network: env.hcs.legacy.network,
          topicMemo: env.hcs.topicMemo,
          topicId,
          status: receipt.status.toString(),
          suggestedEnv: `HCS_TOPIC_ID=${topicId}`,
        },
        null,
        2,
      ),
    );
  } finally {
    client.close();
  }
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
