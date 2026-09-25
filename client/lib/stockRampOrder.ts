// client/lib/stockRampOrder.ts
// Server-side StockRampOrder account decoder — full field set (mirrors
// discord-bot/bot.ts's deserializeStockRampOrder byte-for-byte, including
// reservedAmounts and the trailing optional flutterwaveCredentialId), for
// use by the platform API routes the validator bots depend on
// (elect-executor, initiate-buy-payout, verify-transfer, verify-payment,
// generate-sell-receipt). client/app/api/solana-pay/instant-reserve/
// route.ts has its own smaller parseStockRampOrder that only reads the
// fields it needs (maker/mint/escrowType/amount/pricePerToken/
// reservedCount) — this is the fuller version for routes that also need
// the credential id, fee percentage, currency, or per-reservation details.

import { Connection, PublicKey } from "@solana/web3.js";
import { SOLANA_RPC_ENDPOINT } from "./constant";

export interface ReservedAmount {
  taker: PublicKey;
  amount: string;
  fiatAmount: string;
  timestamp: string;
  sellerInstructions: string | null;
  status: number;
  disputeReason: string | null;
  disputeId: string | null;
  payoutDetails: string | null;
  payoutReference: string | null;
  paymentMode: number;
  paymentLink: string | null;
  transactionReference: string | null;
}

export interface StockRampOrderAccount {
  seed: string;
  maker: PublicKey;
  mint: PublicKey;
  currency: string;
  escrowType: number; // 0 = sell, 1 = buy
  feePercentage: number;
  feeDestination: PublicKey;
  reservedFee: string;
  amount: string;
  pricePerToken: string;
  paymentInstructions: string;
  reservedAmounts: ReservedAmount[];
  flutterwaveCredentialId: string | null;
  bump: number;
}

const STOCK_RAMP_ORDER_DISCRIMINATOR = [28, 141, 210, 123, 210, 232, 91, 251];

function deserializeReservedAmount(data: Buffer, start: number): { data: ReservedAmount; newOffset: number } {
  let offset = start;
  const taker = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  const amount = data.readBigUInt64LE(offset); offset += 8;
  const fiatAmount = data.readBigUInt64LE(offset); offset += 8;
  const timestamp = data.readBigInt64LE(offset); offset += 8;

  const readOptString = (): string | null => {
    const has = data.readUInt8(offset) === 1; offset += 1;
    if (!has) return null;
    const len = data.readUInt32LE(offset); offset += 4;
    const s = data.subarray(offset, offset + len).toString("utf8");
    offset += len;
    return s;
  };

  const sellerInstructions = readOptString();
  const status = data.readUInt8(offset); offset += 1;
  const disputeReason = readOptString();
  const disputeId = readOptString();
  const payoutDetails = readOptString();
  const payoutReference = readOptString();
  const paymentMode = data.readUInt8(offset); offset += 1;
  const paymentLink = readOptString();
  const transactionReference = readOptString();

  return {
    data: {
      taker,
      amount: amount.toString(),
      fiatAmount: fiatAmount.toString(),
      timestamp: timestamp.toString(),
      sellerInstructions,
      status,
      disputeReason,
      disputeId,
      payoutDetails,
      payoutReference,
      paymentMode,
      paymentLink,
      transactionReference,
    },
    newOffset: offset,
  };
}

export function deserializeStockRampOrder(data: Buffer): StockRampOrderAccount {
  let offset = 0;
  const discriminator = Array.from(data.subarray(0, 8));
  if (!discriminator.every((v, i) => v === STOCK_RAMP_ORDER_DISCRIMINATOR[i])) {
    throw new Error(`Invalid StockRampOrder discriminator: ${discriminator}`);
  }
  offset = 8;

  const seed = data.readBigUInt64LE(offset); offset += 8;
  const maker = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  const mint = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  const currency = data.subarray(offset, offset + 3).toString("utf8").replace(/\0/g, ""); offset += 3;
  const escrowType = data.readUInt8(offset); offset += 1;
  const feePercentage = data.readUInt16LE(offset); offset += 2;
  const feeDestination = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  const reservedFee = data.readBigUInt64LE(offset); offset += 8;
  const amount = data.readBigUInt64LE(offset); offset += 8;
  const pricePerToken = data.readBigUInt64LE(offset); offset += 8;

  const instrLen = data.readUInt32LE(offset); offset += 4;
  const paymentInstructions = data.subarray(offset, offset + instrLen).toString("utf8"); offset += instrLen;

  const reservedCount = data.readUInt32LE(offset); offset += 4;
  const reservedAmounts: ReservedAmount[] = [];
  for (let i = 0; i < reservedCount; i++) {
    const res = deserializeReservedAmount(data, offset);
    reservedAmounts.push(res.data);
    offset = res.newOffset;
  }

  const hasCredId = data.readUInt8(offset) === 1; offset += 1;
  let flutterwaveCredentialId: string | null = null;
  if (hasCredId) {
    const len = data.readUInt32LE(offset); offset += 4;
    flutterwaveCredentialId = data.subarray(offset, offset + len).toString("utf8");
    offset += len;
  }

  const bump = data.readUInt8(offset);

  return {
    seed: seed.toString(),
    maker,
    mint,
    currency,
    escrowType,
    feePercentage,
    feeDestination,
    reservedFee: reservedFee.toString(),
    amount: amount.toString(),
    pricePerToken: pricePerToken.toString(),
    paymentInstructions,
    reservedAmounts,
    flutterwaveCredentialId,
    bump,
  };
}

let sharedConnection: Connection | null = null;
function getConnection(): Connection {
  if (!sharedConnection) {
    sharedConnection = new Connection(process.env.RPC_URL || SOLANA_RPC_ENDPOINT, "confirmed");
  }
  return sharedConnection;
}

export async function fetchStockRampOrder(orderAddress: string): Promise<StockRampOrderAccount> {
  const connection = getConnection();
  const info = await connection.getAccountInfo(new PublicKey(orderAddress));
  if (!info) throw new Error(`StockRampOrder account not found: ${orderAddress}`);
  return deserializeStockRampOrder(info.data);
}
