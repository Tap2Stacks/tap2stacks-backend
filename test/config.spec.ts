import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NEW_ENV_VALUES: Record<string, string> = {
  PORT: '3000',
  POSTGRES_URL: 'postgres://postgres:postgres@localhost:5432/st_backend',
  REDIS_URL: 'redis://localhost:6379',
  WAL_PATH: 'wal',
  ACCOUNT_SHARD_COUNT: '16',
  ENGINE_URL: 'http://localhost:8080',
  RPC_URL: 'https://sepolia.base.org',
  VAULT_ADDRESS: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  TUSDC_ADDRESS: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  PROOF_ANCHOR_ADDRESS: '0xcccccccccccccccccccccccccccccccccccccccc',
  DEPLOY_BLOCK: '1000',
  BOT_WALLETS:
    '0x1111111111111111111111111111111111111111,0x2222222222222222222222222222222222222222',
  RUN_SETTLEMENT: 'true',
  PROOF_ANCHOR_ENABLED: 'true',
  GEOFENCE_ENABLED: 'false',
  JWT_SECRET: 'test-jwt-secret',
  ADMIN_API_KEY: 'test-admin-api-key-0123456789abcdef',
  CELL_SIGNER_KEY: 'test-cell-signer-key',
  ENGINE_TOKEN: 'test-engine-token',
  WITHDRAW_SIGNER_PRIVATE_KEY:
    '0x1111111111111111111111111111111111111111111111111111111111111111',
  RELAYER_PRIVATE_KEY:
    '0x2222222222222222222222222222222222222222222222222222222222222222',
  CDP_PAYMASTER_URL: 'https://paymaster.example.com',
};

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...NEW_ENV_VALUES };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads with only the new env names set', async () => {
    const configModule = await import('src/config');
    const { error, value } = configModule.envVarsSchema
      .prefs({ errors: { label: 'key' } })
      .validate(NEW_ENV_VALUES);

    expect(error).toBeUndefined();
    expect(value.POSTGRES_URL).toBe(NEW_ENV_VALUES.POSTGRES_URL);
    expect(value.REDIS_URL).toBe(NEW_ENV_VALUES.REDIS_URL);
    expect(value.RPC_URL).toBe(NEW_ENV_VALUES.RPC_URL);

    const schemaDescription = configModule.envVarsSchema.describe();
    const schemaKeys = Object.keys(schemaDescription.keys ?? {});

    for (const removedKey of [
      'CLICKHOUSE_URL',
      'KAFKA_BROKER',
      'KAFKA_TOPIC_PREFIX',
      'KAFKA_RUNNING_FLAG',
      'MINIO_HOST',
      'MINIO_PORT',
      'MINIO_ACCESS_KEY',
      'MINIO_SECRET_KEY',
      'BUCKET_NAME',
      'LEGACY_NETWORK',
      'LEGACY_OPERATOR_ID',
      'LEGACY_OPERATOR_KEY',
      'LEGACY_MIRROR_NODE_URL',
      'HCS_MODE',
      'HCS_TOPIC_ID',
      'HCS_CREATE_TOPIC_IF_MISSING',
      'HCS_TOPIC_MEMO',
      'HCS_AUTO_ANCHOR_ENABLED',
    ]) {
      expect(schemaKeys).not.toContain(removedKey);
    }

    expect(configModule.env.port).toBe(3000);
    expect(configModule.env.postgres.url).toBe(NEW_ENV_VALUES.POSTGRES_URL);
    expect(configModule.env.redis.url).toBe(NEW_ENV_VALUES.REDIS_URL);
    expect(configModule.env.web3.rpc).toBe(NEW_ENV_VALUES.RPC_URL);
    expect(configModule.env.engine.url).toBe(NEW_ENV_VALUES.ENGINE_URL);
    expect(configModule.env.flag.runSettlement).toBe(true);
    expect(configModule.env.flag.proofAnchorEnabled).toBe(true);
    expect(configModule.env.flag.geofenceEnabled).toBe(false);
    expect(configModule.env.botWallets).toEqual([
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ]);
  });
});
