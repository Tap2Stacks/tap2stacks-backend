import * as dotenv from 'dotenv';
import * as Joi from 'joi';

dotenv.config();

export const isLocal = process.env.NODE_ENV === 'local';

export const envVarsSchema = Joi.object()
  .keys({
    NODE_ENV: Joi.string()
      .valid('production', 'development', 'test', 'local', 'staging')
      .default('development'),
    PORT: Joi.number().default(3000),

    WAL_PATH: Joi.string().default('wal'),
    ACCOUNT_SHARD_COUNT: Joi.number().integer().min(1).default(16),

    POSTGRES_URL: Joi.string().required(),
    REDIS_URL: Joi.string().required(),

    ENGINE_URL: Joi.string().required(),
    ENGINE_TOKEN: Joi.string().required(),

    RPC_URL: Joi.string().required(),
    VAULT_ADDRESS: Joi.string().allow('').default(''),
    TUSDC_ADDRESS: Joi.string().allow('').default(''),
    PROOF_ANCHOR_ADDRESS: Joi.string().allow('').default(''),
    DEPLOY_BLOCK: Joi.number().integer().min(0).default(0),

    BOT_WALLETS: Joi.string().allow('').default(''),

    RUN_SETTLEMENT: Joi.boolean().default(true),
    PROOF_ANCHOR_ENABLED: Joi.boolean().default(true),
    GEOFENCE_ENABLED: Joi.boolean().default(false),
    DEV_FAUCET_ENABLED: Joi.boolean().default(false),

    JWT_SECRET: Joi.string().required(),
    ADMIN_API_KEY: Joi.string().min(32).required(),
    CELL_SIGNER_KEY: Joi.string().required(),
    WITHDRAW_SIGNER_PRIVATE_KEY: Joi.string().required(),
    RELAYER_PRIVATE_KEY: Joi.string().required(),
    CDP_PAYMASTER_URL: Joi.string().allow('').default(''),
  })
  .unknown();

export function parseEnv(rawEnv: NodeJS.ProcessEnv = process.env) {
  const { value: envVars, error } = envVarsSchema
    .prefs({ errors: { label: 'key' } })
    .validate(rawEnv);

  if (error != null) {
    throw new Error(`Config validation error: ${error.message}`);
  }

  return {
    env: envVars.NODE_ENV as string,
    port: Number(envVars.PORT),
    account: {
      walPath: envVars.WAL_PATH as string,
      shardCount: Number(envVars.ACCOUNT_SHARD_COUNT),
    },
    postgres: {
      url: envVars.POSTGRES_URL as string,
    },
    redis: {
      url: envVars.REDIS_URL as string,
    },
    engine: {
      url: envVars.ENGINE_URL as string,
      token: envVars.ENGINE_TOKEN as string,
    },
    web3: {
      rpc: envVars.RPC_URL as string,
      rpcUrl: envVars.RPC_URL as string,
      vaultAddress: envVars.VAULT_ADDRESS as string,
      tusdcAddress: envVars.TUSDC_ADDRESS as string,
      proofAnchorAddress: envVars.PROOF_ANCHOR_ADDRESS as string,
      deployBlock: Number(envVars.DEPLOY_BLOCK),
    },
    botWallets: String(envVars.BOT_WALLETS || '')
      .split(',')
      .map((wallet) => wallet.trim())
      .filter(Boolean),
    flag: {
      runSettlement:
        envVars.RUN_SETTLEMENT === true || envVars.RUN_SETTLEMENT === 'true',
      proofAnchorEnabled:
        envVars.PROOF_ANCHOR_ENABLED === true ||
        envVars.PROOF_ANCHOR_ENABLED === 'true',
      geofenceEnabled:
        envVars.GEOFENCE_ENABLED === true ||
        envVars.GEOFENCE_ENABLED === 'true',
      devFaucetEnabled:
        envVars.DEV_FAUCET_ENABLED === true ||
        envVars.DEV_FAUCET_ENABLED === 'true',
    },
    secret: {
      jwtSecret: envVars.JWT_SECRET as string,
      cellSignerKey: envVars.CELL_SIGNER_KEY as string,
      engineToken: envVars.ENGINE_TOKEN as string,
      adminApiKey: envVars.ADMIN_API_KEY as string,
      withdrawSignerPrivateKey: envVars.WITHDRAW_SIGNER_PRIVATE_KEY as string,
      relayerPrivateKey: envVars.RELAYER_PRIVATE_KEY as string,
      cdpPaymasterUrl: envVars.CDP_PAYMASTER_URL as string,
    },
  };
}

export const env = parseEnv(process.env);
