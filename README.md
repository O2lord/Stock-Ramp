# StockRamp

A non-custodial, tokenized-equity-to-fiat settlement protocol built on Solana, focused on African markets. Holders lock tokenized stocks (e.g. `AAPLx`) into an on-chain escrow, a liquidity provider's linked payment processor pays out local fiat directly, and a 5-validator consensus network verifies the payment before releasing the tokens on-chain.

StockRamp is forked from **Trust Vault** (a crypto-to-fiat P2P protocol) — same escrow + validator-consensus architecture, redeployed under its own program ID and adapted for tokenized equities (xStocks) instead of stablecoins. The two products are operationally and financially separate: different deployment, different validator set, different Supabase project.

## How it works

1. A holder of a tokenized stock locks it in a Solana PDA (program-derived address) escrow — never a company wallet.
2. The liquidity provider's linked payment processor (Flutterwave, Paystack, or Korapay) sends fiat directly to the holder's bank account.
3. 5 independent validators watch on-chain events and verify the payment off-chain via processor APIs.
4. 3-of-5 validators vote on-chain → the tokens auto-release to the LP.
5. If the vote window (30 minutes) expires without consensus, the holder is auto-refunded.

**Fees:** live, on-chain configurable basis points (default 0.05%, max 10%), split 20% platform / 60% LP rebate / 20% validator pool.

**Supported currencies:** NGN, GHS, KES, ZAR, UGX, and others depending on active LP availability.

## Repo layout

This is a monorepo combining an Anchor (Solana) program with several off-chain services:

| Path | What it is |
|---|---|
| `programs/stock-ramp/` | The Anchor smart contract — orders, escrow, validator voting, fee splitting |
| `tests/` | Anchor/Mocha test suite (`stock-ramp_test.ts`, error cases, integration, validator-consensus) |
| `client/` | Next.js 14 web app — marketplace, order creation, merchant dashboard, admin panel, wallet connect |
| `validator-bot/` | Node service that watches on-chain events, verifies payments via processor APIs, and submits votes |
| `discord-bot/` | Discord bot for event monitoring, notifications, and processor-credential management via DMs |
| `keeper/` | Price keeper — polls xStocks/Backed Finance quotes and calls `update_price` on open orders |
| `mcp-server/` | MCP (Model Context Protocol) server — lets an AI agent/chat quote prices, prepare orders, and render live Solana Pay QR widgets for buy/sell flows |
| `supabase/migrations/` | SQL migrations for processor credentials, operational tables, validators, receipts |
| `migrations/` | Anchor deploy script |
| `relics/` | Copies of the generated IDL/TS client, vendored into services that need them |

## Prerequisites

- Rust + Solana CLI + [Anchor](https://www.anchor-lang.com/) (see `rust-toolchain.toml` for the pinned Rust version)
- Node.js, with `yarn` for the root/program workspace and `npm` inside each service folder
- A Supabase project (for receipts, payment links, processor credentials, validator records)
- A Solana wallet keypair for local/devnet testing

## Program

- **Program ID (devnet):** `5DLaeZGr4dFhoQkx2hu7QmUYGiS5qmBuNehB5fzGaUkH` (see `Anchor.toml` and `declare_id!` in `programs/stock-ramp/src/lib.rs`)
- Build: `anchor build`
- Test: `anchor test` (runs `yarn run ts-mocha -p ./tsconfig.json -t 1000000 "tests/**/*.ts"`, per `Anchor.toml`)

Key instructions: `initialize_global_state`, `create_buy_order` / `create_sell_order`, `instant_reserve` / `instant_sell_reserve`, `cancel_or_reduce_buy_order`, `stock_ramp_withdraw`, `update_price`, `submit_buy_vote` / `submit_sell_vote`, `finalize_expired_vote`, `close_executed_vote`, plus admin instructions for fees, pausing, and validator registration.

If the program is ever redeployed to a new keypair, keep the program ID in sync across `programs/stock-ramp/src/lib.rs`, `Anchor.toml`, `client/lib/constant.ts`, and the vendored `relics/stock_ramp.ts` files.

## Running the services

Each service has its own `package.json`, `.env`/`.env.example`, and (where present) its own `README.md` with more detail.

**Client (Next.js app)**
```bash
cd client
npm install
npm run dev
```

**Price keeper**
```bash
anchor build   # so target/idl and target/types exist
cd keeper
npm install
cp .env.example .env   # fill in STOCK_RAMP_PROGRAM_ID, KEEPER_KEYPAIR_PATH, etc.
npm run dev
```
See `keeper/README.md` for the sole-LP assumption and the `deployments[]` field-name caveat that needs verifying against xStocks' live API before relying on it.

**Validator bot**
```bash
cd validator-bot
npm install
npm run dev       # single validator
npm run dev:all   # run-all.ts, e.g. multiple validator keys
```

**Discord bot**
```bash
cd discord-bot
npm install
npm run dev
```

**MCP server** (AI-agent facing: quotes, order prep, live QR widgets)
```bash
cd mcp-server
npm install
cp .env.example .env
npm run dev
```
See `mcp-server/README.md` for what's a faithful port from Trust Vault vs. new, and the list of things to verify (Supabase schema/column names, client routes, program ID/IDL path) before it runs end-to-end.

**Supabase**

Apply the migrations under `supabase/migrations/` to your project (e.g. `supabase db push`), in order. Note that `0002_add_korapay_processor.sql` adds Korapay to the processor `CHECK` constraints and must be applied before Korapay credentials can be saved.

## Status / known gaps

- Dispute resolution is explicitly out of scope for this build — `RESERVATION_STATUS.DISPUTED` exists as an on-chain status code, but there is no instruction or UI path to set or resolve it.
- Only one devnet xStocks stand-in mint (`AAPLx`) is currently registered in `client/lib/constant.ts`'s `XSTOCKS_MINTS`; more symbols need throwaway devnet mints added there.
- The xStocks `deployments[]` field name used to extract a Solana mint address (in `keeper/src/xstocksClient.ts` and `mcp-server/src/xstocksClient.ts`) is inferred, not documented — verify against a live API response before depending on it.
- See `Todo.md`, `Fix.md`, and `STOCKRAMP_FRONTEND_PLAN.md` for the full build history, file-by-file Trust Vault → StockRamp mapping, and outstanding mechanical tasks.

## Security notes

- Tokens never leave on-chain escrow until validator consensus is reached; expired votes trigger an automatic refund.
- No StockRamp wallet or employee ever custodies user funds — everything is on Solana's public ledger.
- The program is open source and intended to be publicly auditable.
