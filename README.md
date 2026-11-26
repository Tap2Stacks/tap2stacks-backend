# tap2stacks backend

The game server for **tap2stacks**, a tap-to-predict game on live stock prices, built on Base.

Taps are fast and off-chain; money is on-chain. Players deposit test USDC into a vault on Base Sepolia, tap cells on a live price board, and withdraw with a signed permit. This service holds the ledger, checks and settles every tap against the price stream, and anchors a Merkle root of settled taps on-chain so anyone can verify a result.

| Repo | Role |
|---|---|
| [tap2stacks-web](https://github.com/Tap2Stacks/tap2stacks-web) | Player app (React, wallets, live board) |
| **tap2stacks-backend** | Accounts, taps, settlement, proofs, on-chain money flows (this repo) |
| [tap2stacks-engine](https://github.com/Tap2Stacks/tap2stacks-engine) | Price feed, odds model, quote stream |
| [tap2stacks-contracts](https://github.com/Tap2Stacks/tap2stacks-contracts) | Vault, test USDC and proof anchor on Base Sepolia |

## How a tap works

1. The engine streams board quotes (price rows × 5-second windows, each with a multiplier) and one price sample per second. The backend signs every cell with `CELL_SIGNER_KEY` before publishing the board to players.
2. A player taps a cell. The order module checks the quote is fresh (under 1.5 s old), the window starts at least 5 s ahead, the cell signature is valid, the feed is healthy, the stake fits the per-cell limit and the player's rate limit, then debits the ledger.
3. Each price sample settles open taps: a cell wins when the segment from the previous sample to this one crosses the cell's row, with the row edges included. A window is voided and refunded if the feed had a gap longer than `SETTLEMENT_VOID_GAP_MS` or was stale while the window was open.
4. Settled taps are batched into a Merkle tree with a hash of the price log, and the root is posted to the `ProofAnchor` contract. The proof endpoints return the leaf, the Merkle path and the anchor transaction for any settled tap.

## Modules

| Module | Purpose |
|---|---|
| `auth` | Wallet sign-in, including smart-wallet signatures (ERC-1271 / ERC-6492), JWT sessions |
| `account`, `payment` | Ledger with write-ahead log, balances, idempotent withdrawals |
| `chain` | Indexer for vault deposits and withdrawals; EIP-712 withdraw permits |
| `engine`, `prices` | Engine WebSocket client, price samples, feed health, recent prices |
| `order` | Tap rules, settlement and voiding |
| `proof` | Merkle batches, price-log files, on-chain anchoring, proof lookups |
| `paymaster` | Short-lived tokens for sponsored gas through a Coinbase paymaster |
| `session` | NYSE calendar (holidays and early closes) |
| `feed`, `player`, `socket` | Activity feed, player stats, realtime gateway |
| `health-check` | Liveness endpoint |

## Run

Node.js 24, PostgreSQL and Redis.

```sh
yarn install
yarn migration:up
yarn dev           # watch mode
yarn test          # unit tests (vitest)
yarn test:e2e      # end-to-end tests
yarn build && yarn start
```

Configuration comes from the environment; see [`.env.example`](.env.example). The main keys are listed below.

| Group | Variables |
|---|---|
| Server | `PORT`, `NODE_ENV`, `JWT_SECRET`, `ADMIN_API_KEY`, `GEOFENCE_ENABLED` |
| Storage | `POSTGRES_URL`, `REDIS_URL`, `WAL_PATH`, `ACCOUNT_SHARD_COUNT` |
| Engine | `ENGINE_URL`, `ENGINE_TOKEN`, `ENGINE_PRICE_SOURCE`, `SETTLEMENT_VOID_GAP_MS` |
| Chain | `RPC_URL`, `VAULT_ADDRESS`, `TUSDC_ADDRESS`, `PROOF_ANCHOR_ADDRESS`, `DEPLOY_BLOCK` |
| Signers | `CELL_SIGNER_KEY`, `WITHDRAW_SIGNER_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY` |
| Optional | `CDP_PAYMASTER_URL`, `PROOF_ANCHOR_ENABLED`, `RUN_SETTLEMENT`, `BOT_WALLETS` |

Run a single backend instance per database: settlement uses an advisory lock. `Dockerfile`, `docker-compose.yml` and `fly.toml` are included for deployment.

## Repository rules

Commits use the project identity and are checked by hooks and CI. See [`AGENTS.md`](AGENTS.md).
