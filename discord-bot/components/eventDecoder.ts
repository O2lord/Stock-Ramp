import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";

// ─────────────────────────────────────────────────────────────────────────────
// Stock Ramp event discriminators — copied verbatim from the program IDL
// ("events" section). One program now, so this is the only discriminator table.
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_DISCRIMINATORS: Record<string, number[]> = {
  BuyOrderCancelledEvent: [118, 145, 69, 220, 68, 112, 48, 144],
  BuyOrderCreatedEvent: [158, 4, 42, 74, 250, 125, 66, 173],
  BuyOrderReducedEvent: [250, 72, 155, 121, 173, 162, 112, 178],
  BuyOrdersPausedEvent: [237, 135, 0, 171, 227, 125, 213, 6],
  FeeDestinationUpdatedEvent: [84, 169, 39, 167, 102, 86, 139, 92],
  FeePercentageUpdatedEvent: [159, 56, 203, 216, 111, 194, 177, 206],
  InstantPaymentPayoutQueuedEvent: [126, 74, 232, 24, 151, 193, 25, 55],
  InstantPaymentPayoutResultEvent: [114, 61, 126, 78, 83, 230, 103, 231],
  InstantPaymentReservedEvent: [1, 110, 251, 231, 168, 10, 216, 190],
  InstantSellPaymentResultEvent: [242, 224, 155, 109, 131, 121, 91, 134],
  InstantSellReservationCreatedEvent: [65, 196, 145, 144, 214, 136, 85, 139],
  OrderCloseFailedEvent: [122, 215, 62, 152, 13, 72, 245, 132],
  OrderClosedEvent: [0, 41, 45, 185, 166, 185, 19, 113],
  OrderNearlyEmptyEvent: [124, 48, 123, 227, 88, 248, 241, 150],
  PartialWithdrawalEvent: [145, 236, 133, 111, 56, 164, 255, 176],
  PriceUpdatedEvent: [217, 171, 222, 24, 64, 152, 217, 36],
  SellOrderCreatedEvent: [146, 170, 38, 108, 67, 63, 50, 149],
  SellOrdersPausedEvent: [61, 157, 167, 130, 193, 42, 129, 66],
  ValidatorFeeClaimedEvent: [171, 228, 79, 129, 217, 158, 255, 216],
  ValidatorRegisteredEvent: [68, 238, 147, 217, 210, 141, 46, 180],
  ValidatorRemovedEvent: [49, 23, 179, 208, 124, 3, 231, 59],
  ValidatorVoteCastEvent: [241, 101, 64, 163, 26, 185, 154, 33],
  ValidatorVoteExecutedEvent: [42, 193, 150, 227, 217, 85, 224, 208],
};

export interface DecodedEvent {
  eventType: string;
  [key: string]: unknown;
  participants: { [role: string]: string };
}

/**
 * Minimal cursor over a Borsh-encoded event buffer.
 * Replaces the old decoder's copy-pasted manual-offset arithmetic (which had
 * a documented field-ordering bug in ValidatorVoteExecutedEvent). All bounds
 * are checked; malformed buffers throw rather than silently misreading.
 */
class BufferReader {
  offset = 8; // skip 8-byte discriminator
  constructor(private buf: Buffer) {}

  private need(n: number) {
    if (this.offset + n > this.buf.length) {
      throw new RangeError(
        `BufferReader: need ${n} bytes at offset ${this.offset}, only ${this.buf.length - this.offset} remain`
      );
    }
  }

  pubkey(): PublicKey {
    this.need(32);
    const pk = new PublicKey(this.buf.slice(this.offset, this.offset + 32));
    this.offset += 32;
    return pk;
  }
  u8(): number {
    this.need(1);
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }
  u16(): number {
    this.need(2);
    const v = this.buf.readUInt16LE(this.offset);
    this.offset += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }
  u64(): bigint {
    this.need(8);
    const v = this.buf.readBigUInt64LE(this.offset);
    this.offset += 8;
    return v;
  }
  i64(): bigint {
    this.need(8);
    const v = this.buf.readBigInt64LE(this.offset);
    this.offset += 8;
    return v;
  }
  bool(): boolean {
    return this.u8() === 1;
  }
  string(): string {
    const len = this.u32();
    if (len > 100_000) throw new RangeError(`BufferReader: implausible string length ${len}`);
    this.need(len);
    const s = this.buf.slice(this.offset, this.offset + len).toString("utf8");
    this.offset += len;
    return s;
  }
  optionString(): string | null {
    return this.bool() ? this.string() : null;
  }
  bytes(n: number): Buffer {
    this.need(n);
    const b = this.buf.slice(this.offset, this.offset + n);
    this.offset += n;
    return b;
  }
  remaining(): number {
    return this.buf.length - this.offset;
  }
}

const fmtToken = (raw: bigint, decimals = 9) => (Number(raw) / 10 ** decimals).toFixed(2);
const fmtFiat = (raw: bigint) => Number(raw).toLocaleString();

export class EventDecoder {
  decodeProgramData(programDataBase64: string): DecodedEvent | null {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(programDataBase64, "base64");
    } catch {
      return null;
    }
    if (buffer.length < 8) return null;

    const discriminator = Array.from(buffer.slice(0, 8));
    const eventType = Object.entries(EVENT_DISCRIMINATORS).find(([, d]) =>
      this.arraysEqual(d, discriminator)
    )?.[0];
    if (!eventType) return null;

    try {
      return this.decodeByType(eventType, buffer);
    } catch (err) {
      console.warn(
        `EventDecoder: failed to decode ${eventType} (skipping this log entry):`,
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }

  private arraysEqual(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  private decodeByType(eventType: string, buf: Buffer): DecodedEvent | null {
    const r = new BufferReader(buf);

    switch (eventType) {
      case "BuyOrderCreatedEvent": {
        const stockRampOrder = r.pubkey();
        const buyer = r.pubkey();
        const mint = r.pubkey();
        const amount = r.u64();
        const pricePerToken = r.u64();
        const currency = r.string();
        const paymentInstructions = r.string();
        const flutterwaveCredentialId = r.optionString();
        return {
          eventType,
          stockRampOrder: stockRampOrder.toString(),
          buyer: buyer.toString(),
          mint: mint.toString(),
          amount: amount.toString(),
          pricePerToken: pricePerToken.toString(),
          currency,
          paymentInstructions,
          flutterwaveCredentialId,
          amountFormatted: fmtToken(amount),
          pricePerTokenFormatted: fmtFiat(pricePerToken),
          participants: { buyer: buyer.toString() },
        };
      }

      case "SellOrderCreatedEvent": {
        const stockRampOrder = r.pubkey();
        const seller = r.pubkey();
        const mint = r.pubkey();
        const amount = r.u64();
        const pricePerToken = r.u64();
        const currency = r.string();
        const paymentInstructions = r.string();
        const flutterwaveCredentialId = r.optionString();
        return {
          eventType,
          stockRampOrder: stockRampOrder.toString(),
          seller: seller.toString(),
          mint: mint.toString(),
          amount: amount.toString(),
          pricePerToken: pricePerToken.toString(),
          currency,
          paymentInstructions,
          flutterwaveCredentialId,
          amountFormatted: fmtToken(amount),
          pricePerTokenFormatted: fmtFiat(pricePerToken),
          participants: { seller: seller.toString() },
        };
      }

      case "BuyOrderCancelledEvent": {
        const stockRampOrder = r.pubkey();
        const buyer = r.pubkey();
        const originalAmount = r.u64();
        const timestamp = r.i64();
        return {
          eventType,
          stockRampOrder: stockRampOrder.toString(),
          buyer: buyer.toString(),
          originalAmount: originalAmount.toString(),
          timestamp: timestamp.toString(),
          participants: { buyer: buyer.toString() },
        };
      }

      case "BuyOrderReducedEvent": {
        const stockRampOrder = r.pubkey();
        const buyer = r.pubkey();
        const originalAmount = r.u64();
        const newAmount = r.u64();
        const timestamp = r.i64();
        return {
          eventType,
          stockRampOrder: stockRampOrder.toString(),
          buyer: buyer.toString(),
          originalAmount: originalAmount.toString(),
          newAmount: newAmount.toString(),
          timestamp: timestamp.toString(),
          participants: { buyer: buyer.toString() },
        };
      }

      case "InstantPaymentReservedEvent": {
        const stockRampOrder = r.pubkey();
        const taker = r.pubkey();
        const amount = r.u64();
        const fiatAmount = r.u64();
        const currency = r.string();
        const payoutDetails = r.optionString();
        const payoutReference = r.string();
        return {
          eventType,
          stockRampOrder: stockRampOrder.toString(),
          taker: taker.toString(),
          amount: amount.toString(),
          fiatAmount: fiatAmount.toString(),
          currency,
          payoutDetails,
          payoutReference,
          amountFormatted: fmtToken(amount),
          fiatAmountFormatted: fmtFiat(fiatAmount),
          participants: { taker: taker.toString(), user: taker.toString() },
        };
      }

      case "InstantPaymentPayoutQueuedEvent": {
        const stockRampOrder = r.pubkey();
        const taker = r.pubkey();
        const amount = r.u64();
        const fiatAmount = r.u64();
        const currency = r.string();
        const payoutReference = r.string();
        return {
          eventType,
          stockRampOrder: stockRampOrder.toString(),
          taker: taker.toString(),
          amount: amount.toString(),
          fiatAmount: fiatAmount.toString(),
          currency,
          payoutReference,
          amountFormatted: fmtToken(amount),
          fiatAmountFormatted: fmtFiat(fiatAmount),
          participants: { taker: taker.toString(), user: taker.toString() },
        };
      }

      case "InstantPaymentPayoutResultEvent": {
        const stockRampOrder = r.pubkey();
        const taker = r.pubkey();
        const amount = r.u64();
        const fiatAmount = r.u64();
        const currency = r.string();
        const payoutReference = r.string();
        const success = r.bool();
        const message = r.string();
        return {
          eventType,
          stockRampOrder: stockRampOrder.toString(),
          taker: taker.toString(),
          amount: amount.toString(),
          fiatAmount: fiatAmount.toString(),
          currency,
          payoutReference,
          success,
          message,
          amountFormatted: fmtToken(amount),
          fiatAmountFormatted: fmtFiat(fiatAmount),
          participants: { taker: taker.toString(), user: taker.toString() },
        };
      }

      case "InstantSellReservationCreatedEvent": {
        const stockRampOrder = r.pubkey();
        const maker = r.pubkey();
        const taker = r.pubkey();
        const amount = r.u64();
        const fiatAmount = r.u64();
        const currency = r.string();
        const paymentMode = r.u8();
        const payoutReference = r.string();
        return {
          eventType,
          stockRampOrder: stockRampOrder.toString(),
          maker: maker.toString(),
          taker: taker.toString(),
          amount: amount.toString(),
          fiatAmount: fiatAmount.toString(),
          currency,
          paymentMode,
          payoutReference,
          amountFormatted: fmtToken(amount),
          fiatAmountFormatted: fmtFiat(fiatAmount),
          participants: { seller: maker.toString(), buyer: taker.toString() },
        };
      }

      case "InstantSellPaymentResultEvent": {
        const stockRampOrder = r.pubkey();
        const maker = r.pubkey();
        const taker = r.pubkey();
        const amount = r.u64();
        const fiatAmount = r.u64();
        const currency = r.string();
        const payoutReference = r.string();
        const success = r.bool();
        const message = r.string();
        const feeAmount = r.u64();
        return {
          eventType,
          stockRampOrder: stockRampOrder.toString(),
          maker: maker.toString(),
          taker: taker.toString(),
          amount: amount.toString(),
          fiatAmount: fiatAmount.toString(),
          currency,
          payoutReference,
          success,
          message,
          feeAmount: feeAmount.toString(),
          amountFormatted: fmtToken(amount),
          fiatAmountFormatted: fmtFiat(fiatAmount),
          participants: { seller: maker.toString(), buyer: taker.toString() },
        };
      }

      case "PartialWithdrawalEvent": {
        const stockRampOrder = r.pubkey();
        const maker = r.pubkey();
        const withdrawalAmount = r.u64();
        const remainingAmount = r.u64();
        return {
          eventType,
          stockRampOrder: stockRampOrder.toString(),
          maker: maker.toString(),
          withdrawalAmount: withdrawalAmount.toString(),
          remainingAmount: remainingAmount.toString(),
          withdrawalAmountFormatted: fmtToken(withdrawalAmount),
          remainingAmountFormatted: fmtToken(remainingAmount),
          participants: { maker: maker.toString() },
        };
      }

      case "OrderClosedEvent": {
        const stockRampOrder = r.pubkey();
        const maker = r.pubkey();
        const remainingAmount = r.u64();
        return {
          eventType,
          stockRampOrder: stockRampOrder.toString(),
          maker: maker.toString(),
          remainingAmount: remainingAmount.toString(),
          participants: { maker: maker.toString() },
        };
      }

      case "OrderNearlyEmptyEvent": {
        const stockRampOrder = r.pubkey();
        const maker = r.pubkey();
        const remainingAmount = r.u64();
        const activeReservations = r.u32();
        const timestamp = r.i64();
        return {
          eventType,
          stockRampOrder: stockRampOrder.toString(),
          maker: maker.toString(),
          remainingAmount: remainingAmount.toString(),
          activeReservations,
          timestamp: timestamp.toString(),
          participants: { maker: maker.toString() },
        };
      }

      case "OrderCloseFailedEvent": {
        const stockRampOrder = r.pubkey();
        const maker = r.pubkey();
        const remainingAmount = r.u64();
        const errorCode = r.u32();
        const timestamp = r.i64();
        const reason = r.string();
        return {
          eventType,
          stockRampOrder: stockRampOrder.toString(),
          maker: maker.toString(),
          remainingAmount: remainingAmount.toString(),
          errorCode,
          timestamp: timestamp.toString(),
          reason,
          participants: { maker: maker.toString() },
        };
      }

      case "PriceUpdatedEvent": {
        const stockRampOrder = r.pubkey();
        const maker = r.pubkey();
        const oldPrice = r.u64();
        const newPrice = r.u64();
        const currency = r.string();
        return {
          eventType,
          stockRampOrder: stockRampOrder.toString(),
          maker: maker.toString(),
          oldPrice: oldPrice.toString(),
          newPrice: newPrice.toString(),
          currency,
          oldPriceFormatted: fmtFiat(oldPrice),
          newPriceFormatted: fmtFiat(newPrice),
          participants: { maker: maker.toString() },
        };
      }

      case "ValidatorVoteCastEvent": {
        const stockRampOrder = r.pubkey();
        const validator = r.pubkey();
        const payoutReference = r.string();
        const vote = r.bool();
        const votesFor = r.u8();
        const votesAgainst = r.u8();
        const timestamp = r.i64();
        return {
          eventType,
          stockRampOrder: stockRampOrder.toString(),
          validator: validator.toString(),
          payoutReference,
          vote,
          votesFor,
          votesAgainst,
          timestamp: timestamp.toString(),
          // Informational only — no end-user notification, but kept for logging/audit.
          participants: {},
        };
      }

      case "ValidatorVoteExecutedEvent": {
        const stockRampOrder = r.pubkey();
        const taker = r.pubkey();
        const payoutReference = r.string();
        const success = r.bool();
        const message = r.string();
        const amount = r.u64();
        const fiatAmount = r.u64();
        const currency = r.string();
        const timestamp = r.i64();
        return {
          eventType,
          stockRampOrder: stockRampOrder.toString(),
          taker: taker.toString(),
          payoutReference,
          success,
          message,
          amount: amount.toString(),
          fiatAmount: fiatAmount.toString(),
          currency,
          timestamp: timestamp.toString(),
          amountFormatted: fmtToken(amount),
          fiatAmountFormatted: fmtFiat(fiatAmount),
          // maker is NOT in this event — bot.ts must fetch the StockRampOrder
          // account to resolve it, then merge it into participants itself.
          participants: { taker: taker.toString() },
        };
      }

      case "BuyOrdersPausedEvent":
      case "SellOrdersPausedEvent": {
        const authority = r.pubkey();
        const paused = r.bool();
        const timestamp = r.i64();
        return {
          eventType,
          authority: authority.toString(),
          paused,
          timestamp: timestamp.toString(),
          participants: {}, // admin/ops event — no end-user notification
        };
      }

      case "FeeDestinationUpdatedEvent": {
        const authority = r.pubkey();
        const oldDestination = r.pubkey();
        const newDestination = r.pubkey();
        const timestamp = r.i64();
        return {
          eventType,
          authority: authority.toString(),
          oldDestination: oldDestination.toString(),
          newDestination: newDestination.toString(),
          timestamp: timestamp.toString(),
          participants: {},
        };
      }

      case "FeePercentageUpdatedEvent": {
        const authority = r.pubkey();
        const oldFee = r.u16();
        const newFee = r.u16();
        const timestamp = r.i64();
        return {
          eventType,
          authority: authority.toString(),
          oldFee,
          newFee,
          timestamp: timestamp.toString(),
          participants: {},
        };
      }

      case "ValidatorRegisteredEvent":
      case "ValidatorRemovedEvent": {
        const authority = r.pubkey();
        const validator = r.pubkey();
        const slot = r.u8();
        const timestamp = r.i64();
        return {
          eventType,
          authority: authority.toString(),
          validator: validator.toString(),
          slot,
          timestamp: timestamp.toString(),
          participants: {},
        };
      }

      case "ValidatorFeeClaimedEvent": {
        const validator = r.pubkey();
        const mint = r.pubkey();
        const amount = r.u64();
        const timestamp = r.i64();
        return {
          eventType,
          validator: validator.toString(),
          mint: mint.toString(),
          amount: amount.toString(),
          timestamp: timestamp.toString(),
          participants: {},
        };
      }

      default:
        return null;
    }
  }
}