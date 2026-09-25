import { Client, GatewayIntentBits } from "discord.js";
import { Connection, PublicKey, AccountInfo } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { EventParser, ParsedEvent } from "./components/eventParser.js";
import { NotificationManager } from "./components/notifications.js";
import { RoleSpecificEmbeds } from "./components/roleSpecificEmbeds.js";
import FlutterwaveService from "./services/flutterwaveService.js";
import OpayService from "./services/opayServices.js";
import PaystackService from "./services/paystackService.js";
import KorapayService from "./services/korapayService.js";
import { decrypt } from "./lib/flutterwave-credentials-bot.js";
import { getMint } from "@solana/spl-token";
import { v4 as uuidv4 } from "uuid";

dotenv.config({ path: ".env.local" });

interface LogsContext {
  signature?: string;
  programId?: string;
}
interface TransactionLogs {
  logs: string[];
  signature?: string;
}
interface ReservedAmount {
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
interface StockRampOrderAccount {
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
interface PayoutDetails {
  account_number: string;
  bank_code?: string;
  bank_name?: string;
  account_name?: string;
  beneficiary_name?: string;
  [key: string]: string | undefined;
}

function parsePayoutDetails(details: string | null): PayoutDetails | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details);
    if (!parsed.account_number) throw new Error("Missing account_number");
    return parsed;
  } catch (error) {
    console.error("Failed to parse payout details:", error);
    return null;
  }
}

const STOCK_RAMP_ORDER_DISCRIMINATOR = [28, 141, 210, 123, 210, 232, 91, 251];
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

class StockRampDiscordBot {
  private readonly client: Client;
  private readonly connection: Connection;
  private readonly eventParser: EventParser;
  private readonly notificationManager: NotificationManager;
  private readonly embedCreator: RoleSpecificEmbeds;
  private readonly flutterwaveService: FlutterwaveService;
  private isListening = false;
  private eventsProcessed = 0;
  private notificationsSent = 0;
  private processedReservations = new Set<string>();
  private processedSignatures = new Set<string>();
  private readonly SIGNATURE_CACHE_SIZE = 1000;

  constructor() {
    console.log("🔧 Constructing bot instance...");

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.DirectMessageTyping,
      ],
    });

    const rpcUrl =
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
    console.log(`🌐 Using Solana RPC: ${rpcUrl}`);
    this.connection = new Connection(rpcUrl, {
      commitment: "confirmed",
      wsEndpoint: rpcUrl.replace("https://", "wss://").replace("http://", "ws://"),
    });

    this.eventParser = new EventParser();
    this.notificationManager = new NotificationManager(this.client);
    this.embedCreator = new RoleSpecificEmbeds();

    const platformKey = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!platformKey) throw new Error("FLUTTERWAVE_SECRET_KEY environment variable is required for utility methods");
    this.flutterwaveService = new FlutterwaveService(platformKey);

    console.log("✅ Bot instance constructed");
  }

  // ── Dedup ──────────────────────────────────────────────────────────────────

  private hasProcessedSignature(signature: string): boolean {
    if (this.processedSignatures.has(signature)) return true;
    this.processedSignatures.add(signature);
    if (this.processedSignatures.size > this.SIGNATURE_CACHE_SIZE) {
      const first = this.processedSignatures.values().next().value;
      if (first !== undefined) this.processedSignatures.delete(first);
    }
    return false;
  }

  // ── StockRampOrder account deserialization ──────────────────────────────────

  private async fetchAccountWithRetry(pubkey: PublicKey, maxRetries = 3, delayMs = 1000): Promise<AccountInfo<Buffer> | null> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const info = await this.connection.getAccountInfo(pubkey);
        if (info) return info;
        console.warn(`⚠️ Account not found on attempt ${attempt}`);
      } catch (error) {
        console.error(`❌ Error fetching account on attempt ${attempt}:`, error);
        if (attempt === maxRetries) throw error;
        await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt - 1)));
      }
    }
    return null;
  }

  private deserializeStockRampOrder(data: Buffer): StockRampOrderAccount {
    let offset = 0;
    const discriminator = Array.from(data.slice(0, 8));
    if (!discriminator.every((v, i) => v === STOCK_RAMP_ORDER_DISCRIMINATOR[i])) {
      throw new Error(`Invalid StockRampOrder discriminator: ${discriminator}`);
    }
    offset = 8;

    const seed = data.readBigUInt64LE(offset); offset += 8;
    const maker = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const mint = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const currency = data.slice(offset, offset + 3).toString("utf8").replace(/\0/g, ""); offset += 3;
    const escrowType = data.readUInt8(offset); offset += 1;
    const feePercentage = data.readUInt16LE(offset); offset += 2;
    const feeDestination = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const reservedFee = data.readBigUInt64LE(offset); offset += 8;
    const amount = data.readBigUInt64LE(offset); offset += 8;
    const pricePerToken = data.readBigUInt64LE(offset); offset += 8;

    const instrLen = data.readUInt32LE(offset); offset += 4;
    const paymentInstructions = data.slice(offset, offset + instrLen).toString("utf8"); offset += instrLen;

    const reservedCount = data.readUInt32LE(offset); offset += 4;
    const reservedAmounts: ReservedAmount[] = [];
    for (let i = 0; i < reservedCount; i++) {
      const res = this.deserializeReservedAmount(data, offset);
      reservedAmounts.push(res.data);
      offset = res.newOffset;
    }

    const hasCredId = data.readUInt8(offset) === 1; offset += 1;
    let flutterwaveCredentialId: string | null = null;
    if (hasCredId) {
      const len = data.readUInt32LE(offset); offset += 4;
      flutterwaveCredentialId = data.slice(offset, offset + len).toString("utf8");
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

  private deserializeReservedAmount(data: Buffer, start: number): { data: ReservedAmount; newOffset: number } {
    let offset = start;
    const taker = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const amount = data.readBigUInt64LE(offset); offset += 8;
    const fiatAmount = data.readBigUInt64LE(offset); offset += 8;
    const timestamp = data.readBigInt64LE(offset); offset += 8;

    const readOptString = (): string | null => {
      const has = data.readUInt8(offset) === 1; offset += 1;
      if (!has) return null;
      const len = data.readUInt32LE(offset); offset += 4;
      const s = data.slice(offset, offset + len).toString("utf8");
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

  private async detectTokenProgram(mint: PublicKey): Promise<{ tokenProgram: PublicKey }> {
    const info = await this.connection.getAccountInfo(mint);
    if (!info) throw new Error(`Mint account not found: ${mint.toString()}`);
    if (info.owner.equals(TOKEN_2022_PROGRAM)) return { tokenProgram: TOKEN_2022_PROGRAM };
    if (info.owner.equals(TOKEN_PROGRAM)) return { tokenProgram: TOKEN_PROGRAM };
    throw new Error(`Unknown token program for mint: ${info.owner.toString()}`);
  }

  // ── Handle: a taker just reserved into a BUY order (validators will settle) ─

  private async handleInstantPaymentReserved(event: ParsedEvent): Promise<void> {
    console.log("\n🔵 InstantPaymentReserved — notifying participants (validators will settle)");
    const { stockRampOrder, taker, amount, fiatAmount, currency, payoutReference } = event.data as any;

    try {
      const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      await supabaseAdmin.from("payout_logs").insert({
        payout_reference: payoutReference,
        taker,
        amount,
        fiat_amount: fiatAmount,
        currency,
        status: "pending_validator_consensus",
        order_type: "buy",
        timestamp: new Date().toISOString(),
        event_signature: event.signature,
      });
    } catch (dbError) {
      console.error("❌ Failed to log buy reservation:", dbError);
    }

    await this.sendEventNotifications(event);
    console.log("✅ Buy reservation acknowledged — validators will vote and settle\n");
  }

  // ── Handle: a buyer just reserved into a SELL order ─────────────────────────

  private async handleInstantSellReservation(event: ParsedEvent): Promise<void> {
    const { paymentMode, stockRampOrder, taker, fiatAmount, currency, payoutReference } = event.data as any;
    const signature = event.signature;

    if (!payoutReference || !stockRampOrder) {
      console.error("⛔ Missing required data for sell reservation");
      return;
    }

    const dedupeKey = `${stockRampOrder}-${payoutReference}`;
    if (this.processedReservations.has(dedupeKey)) {
      console.log(`⚠️  Skipping duplicate reservation: ${payoutReference}`);
      return;
    }
    this.processedReservations.add(dedupeKey);
    setTimeout(() => this.processedReservations.delete(dedupeKey), 5 * 60 * 1000);

    try {
      await new Promise((r) => setTimeout(r, 1500)); // let the account settle

      const orderInfo = await this.fetchAccountWithRetry(new PublicKey(stockRampOrder), 3, 1000);
      if (!orderInfo) throw new Error("StockRampOrder account not found after retries");

      const { maker, mint, flutterwaveCredentialId } = this.deserializeStockRampOrder(orderInfo.data);
      const sellerAddress = maker.toString();

      const { tokenProgram } = await this.detectTokenProgram(mint);
      const mintInfo = await getMint(this.connection, mint, "confirmed", tokenProgram);
      const scaledFiatAmount = parseFloat(fiatAmount) / Math.pow(10, mintInfo.decimals);

      if (paymentMode === 0) {
        console.log("📝 Payment Link Mode detected");
        await this.generatePaymentLink(
          sellerAddress,
          scaledFiatAmount,
          currency,
          payoutReference,
          taker,
          stockRampOrder,
          signature,
          flutterwaveCredentialId
        );
      } else if (paymentMode === 1) {
        console.log("📡 API Monitoring Mode — starting passive payment watch");
        await this.startPassivePaymentMonitoring(
          sellerAddress,
          stockRampOrder,
          payoutReference,
          scaledFiatAmount,
          taker,
          flutterwaveCredentialId
        );
      } else {
        throw new Error(`Invalid payment mode: ${paymentMode}`);
      }

      event.participants.maker = sellerAddress;
      await this.sendEventNotifications(event);
    } catch (error) {
      console.error("⛔ Error handling InstantSellReservationCreatedEvent:", error);
      await this.logPayoutError(event, "SELL_RESERVATION_ERROR", error instanceof Error ? error.message : "Unknown error");
    }
  }

  // ── Payment link generation (multi-processor) ───────────────────────────────

  private async generatePaymentLink(
    sellerAddress: string,
    amount: number,
    currency: string,
    reference: string,
    buyerAddress: string,
    stockRampOrder: string,
    transactionSignature: string,
    sellerCredentialId: string | null
  ): Promise<void> {
    try {
      if (!transactionSignature || !sellerAddress || !reference || !buyerAddress || !stockRampOrder) {
        throw new Error("Missing required parameters for payment link generation");
      }
      if (amount <= 0) throw new Error("Invalid amount");

      // The credential ID lives directly on the on-chain StockRampOrder
      // account (`flutterwaveCredentialId`, set at order creation and
      // deserialized by the caller via deserializeStockRampOrder()) — there
      // is no separate order-credential link table for stock-ramp. See
      // supabase/migrations/0001_payment_processor_credentials.sql: unlike
      // trust_vault, stock-ramp's on-chain order already stores this id.
      if (!sellerCredentialId) {
        throw new Error("No credential linked to this sell order. Seller must link a payment account.");
      }

      const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

      const { data: credData } = await supabaseAdmin
        .from("seller_flutterwave_accounts")
        .select(
          "processor, encrypted_secret_key, encryption_iv, encryption_auth_tag, encrypted_public_key, encryption_public_key_iv, encryption_public_key_auth_tag, processor_account_id"
        )
        .eq("id", sellerCredentialId)
        .single();

      const processor = credData?.processor ?? "flutterwave";
      const redirectUrl = `${process.env.NEXT_PUBLIC_APP_URL}/payment-success/${reference}`;
      let paymentLink: string;

      if (processor === "paystack") {
        if (!credData?.encrypted_secret_key) throw new Error("Paystack credential missing secret key");
        const secretKey = decrypt(credData.encrypted_secret_key, credData.encryption_iv, credData.encryption_auth_tag);
        const result = await PaystackService.createInstance({ secretKey }).createPaymentLink({
          amount,
          currency,
          reference,
          returnUrl: redirectUrl,
          buyerEmail: "buyer@stockramp.io",
          description: `Purchase tokens - Ref: ${reference}`,
          trustExpressAddress: stockRampOrder,
        });
        if (!result.success || !result.authorizationUrl) throw new Error(result.error ?? "Paystack link generation failed");
        paymentLink = result.authorizationUrl;
      } else if (processor === "korapay") {
        if (!credData?.encrypted_secret_key) throw new Error("Korapay credential missing secret key");
        const secretKey = decrypt(credData.encrypted_secret_key, credData.encryption_iv, credData.encryption_auth_tag);
        const result = await KorapayService.createInstance({ secretKey }).createPaymentLink({
          amount,
          currency,
          reference,
          redirectUrl,
          buyerEmail: "buyer@stockramp.io",
          description: `Purchase tokens - Ref: ${reference}`,
        });
        if (!result.success || !result.checkoutUrl) throw new Error(result.error ?? "Korapay link generation failed");
        paymentLink = result.checkoutUrl;
      } else if (processor === "opay") {
        if (!credData?.encrypted_public_key || !credData?.encryption_public_key_iv || !credData?.encryption_public_key_auth_tag || !credData?.processor_account_id) {
          throw new Error("OPay credential missing public key or merchant ID fields");
        }
        const secretKey = decrypt(credData.encrypted_secret_key, credData.encryption_iv, credData.encryption_auth_tag);
        const publicKey = decrypt(credData.encrypted_public_key, credData.encryption_public_key_iv, credData.encryption_public_key_auth_tag);
        const result = await OpayService.createInstance({ publicKey, secretKey, merchantId: credData.processor_account_id }).createPaymentLink({
          amount,
          currency,
          reference,
          returnUrl: redirectUrl,
          callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/payment-processors/opay/webhook`,
          buyerName: "Token Buyer",
          buyerEmail: "buyer@stockramp.io",
          description: `Purchase tokens - Ref: ${reference}`,
          trustExpressAddress: stockRampOrder,
        });
        if (!result.success || !result.cashierUrl) throw new Error(result.error ?? "OPay link generation failed");
        paymentLink = result.cashierUrl;
      } else {
        paymentLink = await this.flutterwaveService.createPaymentLink(
          {
            amount,
            currency,
            tx_ref: reference,
            redirect_url: redirectUrl,
            customer: { name: "Token Buyer", email: "buyer@stockramp.io" },
            customizations: { title: "Token Purchase", description: `Purchase tokens - Ref: ${reference}` },
            meta: {
              reference,
              source: "stock_ramp_sell_order",
              trust_express_address: stockRampOrder,
              buyer_address: buyerAddress,
              seller_address: sellerAddress,
            },
          },
          redirectUrl,
          sellerCredentialId
        );
      }

      await this.storePaymentLinkInDB(reference, paymentLink, stockRampOrder, buyerAddress, sellerAddress, amount, currency, transactionSignature);
      await this.notifyBuyerWithPaymentLink(buyerAddress, paymentLink, amount, currency, reference);
    } catch (error) {
      console.error("❌ Payment link generation failed:", error);
      await this.logPayoutError(
        {
          type: "InstantSellReservationCreatedEvent",
          data: { payoutReference: reference, taker: buyerAddress, stockRampOrder, amount: amount.toString(), currency },
          participants: { taker: buyerAddress, maker: sellerAddress },
          signature: transactionSignature,
          timestamp: Date.now(),
        } as unknown as ParsedEvent,
        "PAYMENT_LINK_GENERATION_ERROR",
        error instanceof Error ? error.message : "Unknown error"
      );
      throw error;
    }
  }

  private async storePaymentLinkInDB(
    reference: string,
    paymentLink: string,
    stockRampOrder: string,
    buyerAddress: string,
    sellerAddress: string,
    amount: number,
    currency: string,
    transactionSignature: string
  ): Promise<void> {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: existing } = await supabaseAdmin
      .from("payment_links")
      .select("id")
      .eq("payout_reference", reference)
      .maybeSingle();
    if (existing) {
      console.log("⚠️  Payment link already exists for this reference — skipping insert");
      return;
    }

    const { error } = await supabaseAdmin.from("payment_links").insert({
      payout_reference: reference,
      link_url: paymentLink,
      trust_express_address: stockRampOrder,
      buyer_address: buyerAddress,
      seller_address: sellerAddress,
      amount,
      currency,
      transaction_signature: transactionSignature,
      status: "pending",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    if (error) throw new Error(`Database insertion failed: ${error.message}`);
  }

  private async updatePaymentLinkStatus(reference: string, status: "completed" | "failed" | "expired"): Promise<void> {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    await supabaseAdmin.from("payment_links").update({ status, updated_at: new Date().toISOString() }).eq("payout_reference", reference);
  }

  private async notifyBuyerWithPaymentLink(buyerAddress: string, paymentLink: string, amount: number, currency: string, reference: string): Promise<void> {
    const embed = this.embedCreator.createPaymentLinkEmbed({ paymentLink, amount, currency, reference });
    await this.notificationManager.sendNotificationToWallet(buyerAddress, "payment_link_generated", embed);
  }

  // ── Passive payment monitoring (payment_mode 1 — Flutterwave polling only) ──
  // Korapay/Paystack/OPay use webhook-based verification handled by the Next.js
  // app + validator bots; extend this if you need polling for those too.

  private async startPassivePaymentMonitoring(
    sellerAddress: string,
    stockRampOrder: string,
    payoutReference: string,
    expectedAmount: number,
    buyerAddress: string,
    sellerCredentialId: string | null
  ): Promise<void> {
    // Credential ID comes from the on-chain order account's
    // `flutterwaveCredentialId` (deserialized by the caller) — stock-ramp
    // stores it directly on the order, unlike trust_vault's link-table model.
    if (!sellerCredentialId) {
      console.warn("⚠️ No seller credential found for passive monitoring");
      return;
    }

    const maxAttempts = 60;
    let attempts = 0;
    console.log(`📡 Passive payment watch started for ${payoutReference}`);

    const interval = setInterval(async () => {
      attempts++;
      try {
        const transactions = await FlutterwaveService.getRecentTransactions(sellerCredentialId);
        const match = transactions.find((tx: any) => tx.tx_ref === payoutReference && tx.amount >= expectedAmount && tx.status === "successful");

        if (match) {
          clearInterval(interval);
          console.log(`✅ Payment detected for ${payoutReference} — validators will settle on-chain`);

          const sellerEmbed = this.embedCreator.createErrorEmbed(
            "💰 Payment Detected",
            "A buyer's payment was detected. Validators will verify and release tokens shortly.",
            sellerAddress
          );
          await this.notificationManager.sendNotificationToWallet(sellerAddress, "payment_detected", sellerEmbed);

          const buyerEmbed = this.embedCreator.createErrorEmbed(
            "⏳ Payment Verified",
            "Your payment has been detected. Tokens will be released by validators shortly.",
            buyerAddress
          );
          await this.notificationManager.sendNotificationToWallet(buyerAddress, "payment_verified", buyerEmbed);
          return;
        }

        if (attempts >= maxAttempts) {
          clearInterval(interval);
          console.warn(`⏰ Passive monitoring timeout for: ${payoutReference}`);
          const embed = this.embedCreator.createErrorEmbed("Payment Timeout", `No payment received for reference: ${payoutReference}`, sellerAddress);
          await this.notificationManager.sendNotificationToWallet(sellerAddress, "payment_timeout", embed);
        }
      } catch (error) {
        console.error(`❌ Passive poll error (attempt ${attempts}):`, error);
        if (attempts >= maxAttempts) clearInterval(interval);
      }
    }, 5000);
  }

  // ── Handle: validators reached consensus (buy or sell) ──────────────────────

  private async handleValidatorVoteExecuted(event: ParsedEvent): Promise<void> {
    console.log("\n🗳️ ValidatorVoteExecuted — processing settlement outcome...");
    const { stockRampOrder, taker, payoutReference, success, message, amount, fiatAmount } = event.data as any;

    if (!stockRampOrder || !taker || !payoutReference) {
      console.error("❌ Missing required fields in ValidatorVoteExecutedEvent");
      return;
    }

    try {
      const orderInfo = await this.fetchAccountWithRetry(new PublicKey(stockRampOrder), 3, 1000);
      if (!orderInfo) {
        console.error("❌ Could not fetch StockRampOrder account");
        return;
      }
      const { maker, mint, currency: onChainCurrency, escrowType } = this.deserializeStockRampOrder(orderInfo.data);
      const makerAddress = maker.toString();
      event.participants.maker = makerAddress;
      event.participants.taker = taker;

      const mintInfo = await this.connection.getAccountInfo(mint);
      if (!mintInfo) throw new Error(`Could not fetch mint account ${mint.toString()}`);
      const mintDecimals = mintInfo.data[44];
      // fiat_amount means different things per order type. SELL: computed on-chain
      // as amount(base units) × price_per_token, so inflated by 10^decimals.
      // BUY: set by the client as plain fiat. Only descale the sell case.
      const ESCROW_TYPE_BUY = 1;
      const scaledFiatAmount =
        escrowType === ESCROW_TYPE_BUY
          ? Number(fiatAmount).toString()
          : (Number(fiatAmount) / Math.pow(10, mintDecimals)).toString();

      if (success) {
        const receiptId = await this.upsertSettlementReceipt(event, makerAddress, mint.toString(), onChainCurrency, scaledFiatAmount, "success");
        if (receiptId) {
          await this.updatePaymentLinkStatus(payoutReference, "completed");
          await this.sendReceiptNotification(event, receiptId, makerAddress);
        }
      } else {
        console.log(`ℹ️ Trade rejected by validators. Funds returned. Reason: ${message}`);
        await this.updatePaymentLinkStatus(payoutReference, "failed");
        // Rejections previously fell through to a bare `.update()` on a row
        // that only ever gets *inserted* on the success path — that update
        // matched zero rows and Supabase silently no-ops, so rejected trades
        // left no receipts record at all. Route through the same
        // insert-or-update helper as the success path, with status "failed".
        await this.upsertSettlementReceipt(event, makerAddress, mint.toString(), onChainCurrency, scaledFiatAmount, "failed");
        await this.sendEventNotifications(event);
      }

      const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      await supabaseAdmin.from("payout_logs").insert({
        payout_reference: payoutReference,
        status: success ? "completed" : "failed",
        settlement_method: "validator_consensus",
        timestamp: new Date().toISOString(),
        event_signature: event.signature,
      });
    } catch (error) {
      console.error("❌ Error handling ValidatorVoteExecutedEvent:", error);
    }
    console.log("✅ ValidatorVoteExecuted processing complete\n");
  }

  // Insert-or-update a `receipts` row for a settled reservation (buy or
  // sell, success or failed). Tries an update first keyed on
  // payout_reference (covers re-delivered events / already-existing rows);
  // if nothing matched, inserts a fresh row. `status` drives both branches
  // so a rejected trade gets its own "failed" record instead of silently
  // vanishing (see handleValidatorVoteExecuted's failure branch).
  //
  // Between the initial UPDATE (which can match zero rows) and the INSERT
  // below, another writer can create the row first — most notably the
  // validator's own POST /api/bot/generate-sell-receipt call, which inserts
  // a "pending" row for this same payout_reference right after casting its
  // vote. When that happens our INSERT collides on the unique
  // payout_reference constraint (Postgres code 23505). generate-sell-receipt
  // already treats that as "someone else won, use their row" instead of an
  // error; we do the same here — retry the UPDATE against the row that just
  // landed so the settlement outcome (status/signature/mint) still gets
  // written, rather than being silently dropped.
  private async upsertSettlementReceipt(
    event: ParsedEvent,
    makerAddress: string,
    mintAddress: string,
    onChainCurrency: string,
    scaledFiatAmount: string,
    status: "success" | "failed"
  ): Promise<string | null> {
    try {
      const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const bankDetails = parsePayoutDetails((event.data as any).payoutDetails ?? null);
      const payoutReference = (event.data as any).payoutReference;

      const updatePayload = {
        status,
        transaction_signature: event.signature,
        mint_address: mintAddress,
        payout_details: { settlement_type: "validator_vote", message: (event.data as any).message, signature: event.signature },
      };

      const { data: updated } = await supabaseAdmin
        .from("receipts")
        .update(updatePayload)
        .eq("payout_reference", payoutReference)
        .select("id")
        .maybeSingle();

      if (updated) return updated.id;

      const newReceiptId = uuidv4();
      const { data: receipt, error } = await supabaseAdmin
        .from("receipts")
        .insert({
          id: newReceiptId,
          payout_reference: payoutReference,
          transaction_signature: event.signature,
          trust_express_address: (event.data as any).stockRampOrder,
          taker_address: (event.data as any).taker,
          maker_address: makerAddress,
          token_amount: (event.data as any).amount,
          fiat_amount: scaledFiatAmount,
          currency: (event.data as any).currency || onChainCurrency,
          payout_method: "validator_consensus",
          account_number: bankDetails?.account_number ?? null,
          // Was `bankDetails?.bank_code` — that writes the numeric bank
          // code (e.g. "058") into the bank_name column instead of the
          // bank's actual name. Use the real bank_name field.
          bank_name: bankDetails?.bank_name ?? null,
          beneficiary_name: bankDetails?.beneficiary_name ?? bankDetails?.account_name ?? null,
          status,
          mint_address: mintAddress,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (!error) return receipt.id;

      if (error.code === "23505") {
        const { data: retried, error: retryError } = await supabaseAdmin
          .from("receipts")
          .update(updatePayload)
          .eq("payout_reference", payoutReference)
          .select("id")
          .maybeSingle();
        if (retried) return retried.id;
        if (retryError) throw new Error(`Receipt update-after-conflict failed: ${retryError.message}`);
        throw new Error("Receipt insert conflicted but no row found to update afterward");
      }

      throw new Error(`Receipt insert failed: ${error.message}`);
    } catch (error) {
      console.error("❌ Failed to upsert settlement receipt:", error);
      return null;
    }
  }

  private async sendReceiptNotification(event: ParsedEvent, receiptId: string, makerAddress: string): Promise<void> {
    const receiptUrl = `${process.env.NEXT_PUBLIC_APP_URL}/receipts/${receiptId}`;
    const embed = this.embedCreator.createReceiptEmbed({
      receiptId,
      receiptUrl,
      payoutReference: (event.data as any).payoutReference,
      amount: (event.data as any).fiatAmount,
      currency: (event.data as any).currency,
    });
    await this.notificationManager.sendNotificationToWallet((event.data as any).taker, "receipt_generated", embed);
    await this.notificationManager.sendNotificationToWallet(makerAddress, "receipt_generated", embed);
  }

  private async logPayoutError(event: ParsedEvent, errorType: string, errorMessage: string): Promise<void> {
    try {
      const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      await supabaseAdmin.from("payout_errors").insert({
        payout_reference: (event.data as any).payoutReference,
        taker: (event.data as any).taker,
        error_type: errorType,
        error_message: errorMessage,
        event_data: JSON.stringify(event.data),
        timestamp: new Date().toISOString(),
      });
    } catch (dbError) {
      console.error("❌ Failed to log payout error:", dbError);
    }
  }

  // ── Init / event loop ────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    console.log("🚀 Initializing bot...");

    console.log("🔍 Checking Supabase connection...");
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await supabaseAdmin.from("user_subscriptions").select("id").limit(1);
    if (error) throw error;
    console.log("✅ Supabase connection OK");

    console.log("🔑 Logging in to Discord...");
    await this.client.login(process.env.DISCORD_BOT_TOKEN!);

    this.client.on("clientReady", async () => {
      console.log(`✅ Logged in to Discord as ${this.client.user?.tag ?? "unknown"}`);
      await this.startEventListening();
      this.startStatusUpdates();
    });
    this.client.on("error", (error) => console.error("❌ Discord client error:", error));
  }

  private async startEventListening(): Promise<void> {
    if (this.isListening) return;

    console.log("🔍 Running Solana RPC health check...");
    try {
      await this.connection.getVersion();
      console.log("✅ RPC connection healthy");
    } catch (error) {
      console.error("RPC health check failed:", error);
      throw new Error("RPC connection is not healthy");
    }

    const programId = new PublicKey(process.env.STOCK_RAMP_PROGRAM_ID!);
    console.log(`📡 Subscribing to logs for program: ${programId.toString()}`);
    this.connection.onLogs(
      programId,
      (logs: TransactionLogs) => this.processLogs(logs, { signature: logs.signature, programId: programId.toString() }),
      "confirmed"
    );

    this.isListening = true;
    console.log("👂 Now listening for on-chain events");
    await this.sendTestNotification();
    console.log("🟢 Bot is fully up and running\n");
  }

  private async sendTestNotification(): Promise<void> {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: subscriptions } = await supabaseAdmin.from("user_subscriptions").select("*");
    if (!subscriptions?.length) {
      console.log("ℹ️ No subscriptions found — skipping test notification");
      return;
    }
    const testEmbed = this.embedCreator.createTestEmbed();
    for (const sub of subscriptions) {
      await this.notificationManager.sendDiscordNotification(sub, testEmbed);
      this.notificationsSent++;
    }
    console.log(`📨 Sent test notification to ${subscriptions.length} subscriber(s)`);
  }

  private async processLogs(logs: TransactionLogs, context: LogsContext): Promise<void> {
    try {
      this.eventsProcessed++;
      const events = this.eventParser.parseLogsForEvents(logs, context);
      if (events.length === 0) return;

      for (const event of events) {
        await this.handleEvent(event);
      }
    } catch (error) {
      console.error("❌ Bot: Error processing logs:", error);
    }
  }

  private async handleEvent(event: ParsedEvent): Promise<void> {
    try {
      if (event.signature && event.signature !== "unknown" && this.hasProcessedSignature(`${event.signature}-${event.type}`)) {
        console.log(`⏭️ Skipping duplicate event: ${event.type} from ${event.signature.slice(0, 8)}...`);
        return;
      }

      if (event.type === "InstantPaymentReservedEvent") {
        return this.handleInstantPaymentReserved(event);
      }
      if (event.type === "InstantSellReservationCreatedEvent") {
        return this.handleInstantSellReservation(event);
      }
      if (event.type === "ValidatorVoteExecutedEvent") {
        return this.handleValidatorVoteExecuted(event);
      }
      if (event.type === "ValidatorVoteCastEvent") {
        // Informational only — no per-vote notification. Logged via processLogs count.
        return;
      }

      // All other events (order created/cancelled/reduced, price updated,
      // partial withdrawal, order closed): notify participants directly.
      await this.sendEventNotifications(event);
    } catch (error) {
      console.error(`❌ Error handling event ${event.type}:`, error);
    }
  }

  private async sendEventNotifications(event: ParsedEvent): Promise<void> {
    const participants = event.participants || {};
    if (Object.keys(participants).length === 0) return;

    for (const [role, walletAddress] of Object.entries(participants)) {
      if (!walletAddress || !this.isValidRole(role)) continue;
      try {
        const embed = this.embedCreator.createEmbed(event.type as never, event.data as never, role as never);
        const eventTypeKey = this.notificationManager.getEventTypeForRole(event.type, role as never);
        const sent = await this.notificationManager.sendNotificationToWallet(walletAddress, eventTypeKey, embed);
        this.notificationsSent += sent.length;
      } catch (error) {
        console.error(`❌ Failed to send notification to ${role} (${walletAddress}):`, error);
      }
    }
  }

  private isValidRole(role: string): boolean {
    return ["buyer", "seller", "taker", "maker", "user"].includes(role);
  }

  private async startStatusUpdates(): Promise<void> {
    console.log("💓 Starting status heartbeat (every 30s)");
    setInterval(async () => {
      try {
        const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        await supabaseAdmin.from("bot_status").upsert({
          bot_id: "stock_ramp_bot",
          last_seen: new Date().toISOString(),
          events_processed: this.eventsProcessed,
          notifications_sent: this.notificationsSent,
          is_active: true,
        });
        console.log(`💓 Heartbeat — events: ${this.eventsProcessed}, notifications: ${this.notificationsSent}`);
      } catch (error) {
        console.error("❌ Error updating bot status:", error);
      }
    }, 30000);
  }

  async shutdown(): Promise<void> {
    console.log("🛑 Shutting down bot...");
    this.isListening = false;
    await this.client.destroy();
    console.log("✅ Bot shut down cleanly");
  }
}

export default StockRampDiscordBot;

async function main() {
  const bot = new StockRampDiscordBot();
  process.on("SIGINT", async () => { await bot.shutdown(); process.exit(0); });
  process.on("SIGTERM", async () => { await bot.shutdown(); process.exit(0); });
  try {
    await bot.initialize();
  } catch (error) {
    console.error("Failed to start bot:", error);
    process.exit(1);
  }
}

main().catch(console.error);
