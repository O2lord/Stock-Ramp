import { EmbedBuilder } from "discord.js";

interface BaseEventData {
  stockRampOrder?: string;
  timestamp?: string;
}

interface BuyOrderCreatedEventData extends BaseEventData {
  buyer: string;
  amountFormatted: string;
  pricePerTokenFormatted: string;
  currency: string;
}

interface SellOrderCreatedEventData extends BaseEventData {
  seller: string;
  amountFormatted: string;
  pricePerTokenFormatted: string;
  currency: string;
}

interface BuyOrderCancelledEventData extends BaseEventData {
  buyer: string;
  originalAmount: string;
}

interface BuyOrderReducedEventData extends BaseEventData {
  buyer: string;
  originalAmount: string;
  newAmount: string;
}

interface InstantPaymentReservedEventData extends BaseEventData {
  taker: string;
  amountFormatted: string;
  fiatAmountFormatted: string;
  currency: string;
  payoutReference: string;
}

interface InstantSellReservationCreatedEventData extends BaseEventData {
  seller: string;
  maker: string;
  buyer: string;
  taker: string;
  amountFormatted: string;
  fiatAmountFormatted: string;
  currency: string;
  paymentMode: number;
  payoutReference: string;
}

/** Covers BOTH buy-side and sell-side settlement — Stock Ramp uses one
 *  event type for both, unlike the old Trust Express dual-event design. */
interface ValidatorVoteExecutedEventData extends BaseEventData {
  taker: string;
  maker?: string; // resolved by bot.ts from the on-chain account, not in the raw event
  amountFormatted: string;
  fiatAmountFormatted: string;
  currency: string;
  payoutReference: string;
  success: boolean;
  message?: string;
}

interface PartialWithdrawalEventData extends BaseEventData {
  maker: string;
  withdrawalAmountFormatted: string;
  remainingAmountFormatted: string;
}

interface OrderClosedEventData extends BaseEventData {
  maker: string;
  remainingAmount: string;
}

interface PriceUpdatedEventData extends BaseEventData {
  maker: string;
  oldPriceFormatted?: string;
  newPriceFormatted: string;
  currency: string;
}

type EventData =
  | BuyOrderCreatedEventData
  | SellOrderCreatedEventData
  | BuyOrderCancelledEventData
  | BuyOrderReducedEventData
  | InstantPaymentReservedEventData
  | InstantSellReservationCreatedEventData
  | ValidatorVoteExecutedEventData
  | PartialWithdrawalEventData
  | OrderClosedEventData
  | PriceUpdatedEventData;

type UserRole = "buyer" | "seller" | "taker" | "maker" | "user";

type EventType =
  | "BuyOrderCreatedEvent"
  | "SellOrderCreatedEvent"
  | "BuyOrderCancelledEvent"
  | "BuyOrderReducedEvent"
  | "InstantPaymentReservedEvent"
  | "InstantSellReservationCreatedEvent"
  | "ValidatorVoteExecutedEvent"
  | "PartialWithdrawalEvent"
  | "OrderClosedEvent"
  | "PriceUpdatedEvent";

interface Colors {
  readonly SUCCESS: number;
  readonly WARNING: number;
  readonly ERROR: number;
  readonly INFO: number;
  readonly NEUTRAL: number;
  readonly PURPLE: number;
}

export class RoleSpecificEmbeds {
  private readonly colors: Colors = {
    SUCCESS: 0x00ff00,
    WARNING: 0xffaa00,
    ERROR: 0xff0000,
    INFO: 0x0099ff,
    NEUTRAL: 0x808080,
    PURPLE: 0x9932cc,
  };

  createEmbed(eventType: EventType, eventData: EventData, userRole: UserRole): EmbedBuilder {
    switch (eventType) {
      case "BuyOrderCreatedEvent":
        return this.createBuyOrderEmbed(eventData as BuyOrderCreatedEventData, userRole);
      case "SellOrderCreatedEvent":
        return this.createSellOrderEmbed(eventData as SellOrderCreatedEventData, userRole);
      case "BuyOrderCancelledEvent":
        return this.createBuyOrderCancelledEmbed(eventData as BuyOrderCancelledEventData, userRole);
      case "BuyOrderReducedEvent":
        return this.createBuyOrderReducedEmbed(eventData as BuyOrderReducedEventData, userRole);
      case "InstantPaymentReservedEvent":
        return this.createInstantPaymentReservedEmbed(eventData as InstantPaymentReservedEventData, userRole);
      case "InstantSellReservationCreatedEvent":
        return this.createInstantSellReservationEmbed(eventData as InstantSellReservationCreatedEventData, userRole);
      case "ValidatorVoteExecutedEvent":
        return this.createValidatorVoteExecutedEmbed(eventData as ValidatorVoteExecutedEventData, userRole);
      case "PartialWithdrawalEvent":
        return this.createPartialWithdrawalEmbed(eventData as PartialWithdrawalEventData, userRole);
      case "OrderClosedEvent":
        return this.createOrderClosedEmbed(eventData as OrderClosedEventData, userRole);
      case "PriceUpdatedEvent":
        return this.createPriceUpdatedEmbed(eventData as PriceUpdatedEventData, userRole);
      default:
        return this.createGenericEmbed(eventType, eventData, userRole);
    }
  }

  private createBuyOrderEmbed(data: BuyOrderCreatedEventData, role: UserRole): EmbedBuilder {
    if (role === "buyer") {
      return new EmbedBuilder()
        .setTitle("🛒 Your Buy Order is Live!")
        .setColor(this.colors.SUCCESS)
        .setDescription("Sellers can now fill your order.")
        .addFields(
          { name: "🎯 Buying", value: `${data.amountFormatted} tokens`, inline: true },
          { name: "💵 At", value: `${data.pricePerTokenFormatted} ${data.currency}/token`, inline: true },
          { name: "🏪 Order Address", value: `\`${data.stockRampOrder ?? "N/A"}\``, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: "Stock Ramp Notification" });
    }
    return this.createGenericEmbed("BuyOrderCreatedEvent", data, role);
  }

  private createSellOrderEmbed(data: SellOrderCreatedEventData, role: UserRole): EmbedBuilder {
    if (role === "seller") {
      return new EmbedBuilder()
        .setTitle("🏪 Your Sell Order is Live!")
        .setColor(this.colors.SUCCESS)
        .setDescription("Buyers can now purchase your tokens.")
        .addFields(
          { name: "💰 Amount", value: `${data.amountFormatted} tokens`, inline: true },
          { name: "💵 Price", value: `${data.pricePerTokenFormatted} ${data.currency}/token`, inline: true },
          { name: "🏪 Order Address", value: `\`${data.stockRampOrder ?? "N/A"}\``, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: "Stock Ramp Notification" });
    }
    return this.createGenericEmbed("SellOrderCreatedEvent", data, role);
  }

  private createBuyOrderCancelledEmbed(data: BuyOrderCancelledEventData, role: UserRole): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle("💰 Buy Order Cancelled")
      .setColor(this.colors.PURPLE)
      .setDescription("Your buy order has been cancelled and any unreserved capacity returned.")
      .setTimestamp()
      .setFooter({ text: "Stock Ramp Notification" });
  }

  private createBuyOrderReducedEmbed(data: BuyOrderReducedEventData, role: UserRole): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle("💰 Buy Order Reduced")
      .setColor(this.colors.PURPLE)
      .addFields(
        { name: "🪙 Original", value: `${data.originalAmount} tokens`, inline: true },
        { name: "💸 New", value: `${data.newAmount} tokens`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: "Stock Ramp Notification" });
  }

  private createInstantPaymentReservedEmbed(data: InstantPaymentReservedEventData, role: UserRole): EmbedBuilder {
    if (role === "taker" || role === "user") {
      return new EmbedBuilder()
        .setTitle("⚡ Reservation Created — Verifying Your Payment")
        .setColor(this.colors.INFO)
        .setDescription(
          "Your reservation is on-chain. Validators are independently verifying your payment before releasing tokens."
        )
        .addFields(
          { name: "💰 Token Amount", value: `${data.amountFormatted} tokens`, inline: true },
          { name: "💵 Fiat Amount", value: `${data.fiatAmountFormatted} ${data.currency}`, inline: true },
          { name: "📖 Reference", value: `\`${data.payoutReference}\``, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: "Stock Ramp — Validator Settlement" });
    }
    return this.createGenericEmbed("InstantPaymentReservedEvent", data, role);
  }

  private createInstantSellReservationEmbed(
    data: InstantSellReservationCreatedEventData,
    role: UserRole
  ): EmbedBuilder {
    if (role === "seller" || role === "maker") {
      return new EmbedBuilder()
        .setTitle("⚡ Buyer Reserved Your Tokens")
        .setColor(this.colors.WARNING)
        .setDescription("Awaiting the buyer's payment. Validators will settle automatically once confirmed.")
        .addFields(
          { name: "👤 Buyer", value: `\`${data.buyer}\``, inline: true },
          { name: "💰 Amount", value: `${data.amountFormatted} tokens`, inline: true },
          { name: "💵 Expecting", value: `${data.fiatAmountFormatted} ${data.currency}`, inline: true },
          { name: "💳 Mode", value: data.paymentMode === 0 ? "Payment Link" : "Direct Transfer", inline: true },
          { name: "📖 Reference", value: `\`${data.payoutReference}\``, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: "Stock Ramp Instant Sell" });
    }
    if (role === "buyer" || role === "taker") {
      return new EmbedBuilder()
        .setTitle("⚡ Purchase Reserved — Complete Payment")
        .setColor(this.colors.INFO)
        .addFields(
          { name: "👤 Seller", value: `\`${data.seller}\``, inline: true },
          { name: "💰 Amount", value: `${data.amountFormatted} tokens`, inline: true },
          { name: "💸 Pay", value: `${data.fiatAmountFormatted} ${data.currency}`, inline: true },
          { name: "💳 Mode", value: data.paymentMode === 0 ? "Payment Link" : "Direct Transfer", inline: true },
          { name: "📖 Reference", value: `\`${data.payoutReference}\``, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: "Stock Ramp Instant Sell" });
    }
    return this.createGenericEmbed("InstantSellReservationCreatedEvent", data, role);
  }

  /**
   * One embed for BOTH buy-side and sell-side settlement outcomes, since
   * Stock Ramp uses a single ValidatorVoteExecutedEvent for both — unlike the
   * old program's separate InstantPaymentPayoutResultEvent /
   * InstantSellPaymentResultEvent pair.
   */
  private createValidatorVoteExecutedEmbed(data: ValidatorVoteExecutedEventData, role: UserRole): EmbedBuilder {
    if (data.success) {
      const title = role === "maker" || role === "seller" ? "✅ Trade Settled — Proceeds Released" : "🎉 Tokens Received!";
      return new EmbedBuilder()
        .setTitle(title)
        .setColor(this.colors.SUCCESS)
        .setDescription("Validators reached consensus and settled this trade on-chain.")
        .addFields(
          { name: "💰 Amount", value: `${data.amountFormatted} tokens`, inline: true },
          { name: "💵 Fiat", value: `${data.fiatAmountFormatted} ${data.currency}`, inline: true },
          { name: "📖 Reference", value: `\`${data.payoutReference}\``, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: "Stock Ramp — Validator Settlement" });
    }
    return new EmbedBuilder()
      .setTitle("❌ Trade Rejected — Funds Returned")
      .setColor(this.colors.ERROR)
      .setDescription("Validators could not verify this payment. Reserved funds have been returned.")
      .addFields(
        { name: "📖 Reference", value: `\`${data.payoutReference}\``, inline: true },
        { name: "❌ Reason", value: data.message || "Not specified", inline: false }
      )
      .setTimestamp()
      .setFooter({ text: "Stock Ramp — Validator Settlement" });
  }

  private createPartialWithdrawalEmbed(data: PartialWithdrawalEventData, role: UserRole): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle("💰 Withdrawal Processed")
      .setColor(this.colors.PURPLE)
      .addFields(
        { name: "🪙 Withdrawn", value: `${data.withdrawalAmountFormatted} tokens`, inline: true },
        { name: "📦 Remaining", value: `${data.remainingAmountFormatted} tokens`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: "Stock Ramp Notification" });
  }

  private createOrderClosedEmbed(data: OrderClosedEventData, role: UserRole): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle("🏁 Order Closed")
      .setColor(this.colors.PURPLE)
      .setDescription("This order has been fully consumed or withdrawn and its escrow account closed.")
      .setTimestamp()
      .setFooter({ text: "Stock Ramp Notification" });
  }

  private createPriceUpdatedEmbed(data: PriceUpdatedEventData, role: UserRole): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle("💰 Price Updated")
      .setColor(this.colors.PURPLE)
      .addFields(
        { name: "💵 New Price", value: `${data.newPriceFormatted} ${data.currency}`, inline: true },
        ...(data.oldPriceFormatted
          ? [{ name: "📊 Previous", value: `${data.oldPriceFormatted} ${data.currency}`, inline: true }]
          : [])
      )
      .setTimestamp()
      .setFooter({ text: "Stock Ramp Notification" });
  }

  private formatEmbedValue(value: unknown): string {
    if (value === null || value === undefined) return "N/A";
    if (typeof value === "boolean") return value ? "✅ Yes" : "❌ No";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  private createGenericEmbed(eventType: string, data: EventData, role: UserRole): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`📢 ${eventType.replace("Event", "").replace(/([A-Z])/g, " $1").trim()}`)
      .setColor(this.colors.NEUTRAL)
      .setTimestamp()
      .setFooter({ text: "Stock Ramp Notification" });

    const fields = [{ name: "Your Role", value: role, inline: true }];
    for (const [key, value] of Object.entries(data)) {
      if (key === "timestamp" || key === "stockRampOrder") continue;
      fields.push({ name: key, value: this.formatEmbedValue(value), inline: true });
    }
    embed.addFields(fields);
    return embed;
  }

  createErrorEmbed(title: string, description: string, walletAddress?: string): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`⚠️ ${title}`)
      .setColor(this.colors.ERROR)
      .setDescription(description)
      .setTimestamp()
      .setFooter({ text: "Stock Ramp Error Notification" });
    if (walletAddress) {
      embed.addFields({ name: "👤 Affected Wallet", value: `\`${walletAddress}\``, inline: false });
    }
    return embed;
  }

  createReceiptEmbed(data: {
    receiptId: string;
    receiptUrl: string;
    payoutReference: string;
    amount: string;
    currency: string;
  }): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("📄 Transaction Receipt Generated")
      .addFields(
        { name: "Receipt ID", value: data.receiptId, inline: true },
        { name: "Reference", value: data.payoutReference, inline: true },
        { name: "Amount", value: `${data.amount} ${data.currency}`, inline: true },
        { name: "View Receipt", value: `[Click here](${data.receiptUrl})` }
      )
      .setTimestamp();
  }

  createPaymentLinkEmbed(params: { paymentLink: string; amount: number; currency: string; reference: string }): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(this.colors.INFO)
      .setTitle("💳 Complete Your Payment")
      .addFields(
        { name: "💰 Amount", value: `${params.amount} ${params.currency}`, inline: true },
        { name: "📖 Reference", value: `\`${params.reference}\``, inline: true },
        { name: "🔗 Payment Link", value: `[Click here to pay](${params.paymentLink})` }
      )
      .setTimestamp()
      .setFooter({ text: "Stock Ramp Instant Sell" });
  }

  createTestEmbed(): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle("🤖 Bot Started Successfully")
      .setColor(this.colors.SUCCESS)
      .setDescription("The Stock Ramp Discord bot is now monitoring on-chain events.")
      .setTimestamp()
      .setFooter({ text: "Stock Ramp Notification System" });
  }
}

export type {
  BaseEventData,
  BuyOrderCreatedEventData,
  SellOrderCreatedEventData,
  InstantPaymentReservedEventData,
  InstantSellReservationCreatedEventData,
  ValidatorVoteExecutedEventData,
  EventData,
  UserRole,
  EventType,
  Colors,
};