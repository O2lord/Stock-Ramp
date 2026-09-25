// client/components/StockRamp/BuyOrder/CreateBuyDialog.tsx
// Form dialog wrapping `create_buy_order.rs` via `useStockRampProgram().createBuyOrder`.
// Validated client-side with `schemas/buyOrderSchema.ts` (mirrors the exact
// on-chain constraints in `utils.rs::validate_order_fields` / `parse_currency`).
//
// UNITS: "Amount (tokens)" is typed in whole tokens, but `create_buy_order`'s
// `amount` argument is in the mint's BASE UNITS — the same units
// instant_reserve.rs subtracts from it, and the same units the SPL transfers
// move. Sending the unscaled figure here (`new BN(values.amount)`) is what
// made a 0.1-token reservation (100_000 base units) underflow an order
// created for "1 token" (stored as 1), surfacing as AnchorError 6017
// ArithmeticOverflow inside instant_reserve. Scale via
// lib/tokenAmount.ts::toBaseUnits, as every other call site now does.
//
// `flutterwaveCredentialId` is picked from the maker's saved payment-processor
// accounts (Flutterwave/OPay/Paystack — see hooks/usePaymentProcessorCredentials.ts
// and app/stocks/merchant/settings/page.tsx) rather than typed in by hand.
// Buy orders use the "buyer" side — this is the account the maker pays a
// taker's fiat FROM once a reservation is confirmed. Payout instructions are
// no longer collected here — the connected credential is the source of truth
// for how the taker gets paid.
//
// Token is picked via `TokenSelect` (components/ui/select.tsx — the same
// picker trust_vault's CreateBuyDialog uses), populated from the static
// `XSTOCKS_MINTS` stand-in map (see hooks/useXStocksTokenList.ts) rather
// than a raw mint-address text field. The Max/Half quick-fill buttons are
// hidden here (`showBalanceActions={false}`) since a buy order's "amount"
// is how many tokens the maker wants to buy, not a balance they hold —
// unlike CreateSellOrderDialog, where the maker is depositing tokens they
// already own.
//
// "Stock price" is always kept in USD, both as auto-filled and as whatever
// the maker types by hand — it's a straightforward live per-token reference
// to xStocks' USD quote (see hooks/useXStockPrices.ts's useOrderUsdQuote,
// server-proxied so this populates the instant a token is picked, with no
// need to enter an amount or currency first). Once a valid 3-letter
// currency is also entered, the USD -> currency FX rate is derived from
// useOrderQuote (referencePrice / usdQuote — same ratio /api/xstocks/price
// computes server-side) and used to show a live *total* order value in that
// currency underneath — i.e. price-per-token x however many tokens are in
// "Amount (tokens)" right now, since that total (not the per-token price)
// is what's actually useful to a maker sizing an order. It updates as
// either the amount or the currency changes.
//
// The on-chain `price_per_token` argument is fiat, in the order's
// `currency` (see utils.rs::validate_order_fields / create_buy_order.rs) —
// never USD — and is quoted per WHOLE token, not per base unit, so it is
// deliberately NOT scaled by decimals the way `amount` is. At submit time
// the USD figure the maker sees/edited is converted via that same FX ratio
// into the per-token value actually sent to the program. Submission is
// blocked (with a toast) if a live FX rate for the entered currency hasn't
// resolved yet, since there'd be nothing correct to convert with.
//
// Two-step submit, mirroring trust_vault's CreateExpressBuyDialog pattern:
// step 1 is the actual on-chain create_buy_order call; step 2 is a separate,
// off-chain `linkToOrder` call that records the credential<->order link in
// buy_order_credentials (see supabase/migrations/0007_order_credential_links.sql).
// If step 2 fails, we only warn — the order is already live on-chain
// regardless, since flutterwaveCredentialId was already passed as an
// on-chain argument in step 1. So a step-2 failure is cosmetic/query-side,
// never a reason to tell the maker their order didn't go through.

"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/components/ui/use-toast";
import { TokenSelect } from "@/components/ui/select";

import { useStockRampProgram } from "@/hooks/useStockRampProgram";
import { stockRampAccountsQueryKey } from "@/hooks/queries/useStockRampAccounts";
import { useOrderQuote, useOrderUsdQuote } from "@/hooks/useXStockPrices";
import { useXStocksTokenList } from "@/hooks/useXStocksTokenList";
import { usePaymentProcessorCredentials } from "@/hooks/usePaymentProcessorCredentials";
import { parseAnchorError } from "@/lib/parseAnchorError";
import { fetchMintDecimals, toBaseUnits } from "@/lib/tokenAmount";
import { buyOrderSchema, type BuyOrderFormValues } from "@/schemas/buyOrderSchema";
import { CredentialPicker } from "@/components/StockRamp/Shared/CredentialPicker";

interface CreateBuyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateBuyDialog({ open, onOpenChange }: CreateBuyDialogProps) {
  const { createBuyOrder, findStockRampOrderPda, connection } = useStockRampProgram();
  const { publicKey } = useWallet();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  // 0 = idle, 1 = on-chain create in flight, 2 = off-chain credential link in flight
  const [txStep, setTxStep] = React.useState<0 | 1 | 2>(0);

  const tokens = useXStocksTokenList(publicKey);
  const { allCredentials, linkToOrder } = usePaymentProcessorCredentials("buyer");

  const form = useForm<BuyOrderFormValues>({
    resolver: zodResolver(buyOrderSchema),
    defaultValues: {
      mint: "",
      amount: undefined,
      pricePerToken: undefined,
      currency: "",
      paymentInstructions: "",
      flutterwaveCredentialId: "",
    },
  });

  const {
    formState: { dirtyFields },
  } = form;
  const mintValue = form.watch("mint");
  const currencyValue = form.watch("currency");
  const amountValue = Number(form.watch("amount"));
  const priceFieldValue = Number(form.watch("pricePerToken"));

  // Always-USD per-token reference price, available the instant a token is
  // picked — no amount or currency required first.
  const usdPrice = useOrderUsdQuote(mintValue);
  // Used only to derive the USD -> currency FX ratio for the informational
  // total-order-value line, and to convert the USD price at submit time.
  const quote = useOrderQuote(mintValue, currencyValue);
  const fxRate =
    quote.data && quote.data.usdQuote > 0 ? quote.data.referencePrice / quote.data.usdQuote : null;
  const localPerToken =
    fxRate != null && Number.isFinite(priceFieldValue) && priceFieldValue > 0
      ? priceFieldValue * fxRate
      : null;
  const localTotal =
    localPerToken != null && Number.isFinite(amountValue) && amountValue > 0
      ? Math.round(localPerToken * amountValue)
      : null;

  // Auto-fill the "Stock price" field from the live USD quote as long as
  // the maker hasn't typed into it themselves. This field is always USD —
  // the currency conversion is shown separately below, never written back
  // into this field.
  React.useEffect(() => {
    if (dirtyFields.pricePerToken) return;
    if (usdPrice.data != null) {
      form.setValue("pricePerToken", usdPrice.data.usdQuote, { shouldValidate: true });
    }
  }, [usdPrice.data, dirtyFields.pricePerToken, form]);

  async function onSubmit(values: BuyOrderFormValues) {
    if (!publicKey) {
      toast({ title: "Wallet not connected", variant: "destructive" });
      return;
    }
    if (fxRate == null) {
      toast({
        title: "Still fetching a live rate",
        description: `Wait a moment for the live ${values.currency} conversion to finish, then try again.`,
        variant: "destructive",
      });
      return;
    }
    const chainPricePerToken = Math.round(values.pricePerToken * fxRate);

    setIsSubmitting(true);
    try {
      const mint = new PublicKey(values.mint);

      // Whole tokens -> base units. Everything downstream (reservations,
      // cancel/reduce, withdraw, the escrow transfers themselves) is
      // denominated in these units, so the order's stored `amount` has to be
      // too or the first reservation underflows it.
      const decimals = await fetchMintDecimals(connection, mint);
      const rawAmount = toBaseUnits(values.amount, decimals);

      if (rawAmount.isZero()) {
        toast({
          title: "Amount too small",
          description: `The smallest amount this token supports is ${10 ** -decimals}.`,
          variant: "destructive",
        });
        return;
      }

      const seed = new BN(Date.now());
      const [stockRampOrderPda] = findStockRampOrderPda(publicKey, seed);

      // Step 1: the actual on-chain create. This is the transaction that
      // matters — flutterwaveCredentialId is already an on-chain argument
      // here, so the order is fully valid and usable even if step 2 below
      // never runs.
      setTxStep(1);
      await createBuyOrder({
        seed,
        mint,
        amount: rawAmount,
        pricePerToken: new BN(chainPricePerToken),
        currency: values.currency,
        paymentInstructions: values.paymentInstructions ?? "",
        flutterwaveCredentialId: values.flutterwaveCredentialId,
      });

      // Step 2: off-chain, cosmetic/query-side link for fast lookups later
      // (merchant settings, support tooling). Never block success on this.
      setTxStep(2);
      const selectedCredential = allCredentials.find((c) => c.id === values.flutterwaveCredentialId);
      if (selectedCredential) {
        try {
          await linkToOrder(selectedCredential.processor, selectedCredential.id, stockRampOrderPda.toBase58());
        } catch (linkError) {
          console.warn(
            "Failed to link credential to buy order, but the order was created on-chain:",
            linkError
          );
        }
      }

      queryClient.invalidateQueries({ queryKey: stockRampAccountsQueryKey() });
      toast({
        title: "Buy order created",
        description: `Wants ${values.amount} tokens at ${chainPricePerToken} ${values.currency} ($${values.pricePerToken} USD)`,
      });
      form.reset();
      onOpenChange(false);
    } catch (err) {
      const parsed = parseAnchorError(err);
      toast({ title: "Couldn't create buy order", description: parsed.message, variant: "destructive" });
    } finally {
      setTxStep(0);
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create buy order</DialogTitle>
          <DialogDescription>
            Offer fiat for xStocks tokens. Takers will send you tokens and you'll pay them via your
            configured payout method.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="mint"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Token to buy</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <TokenSelect
                        tokens={tokens}
                        value={field.value}
                        showBalanceActions={false}
                        onTokenChange={(token) => field.onChange(token?.mint ?? "")}
                        onMaxClick={() => {}}
                        onHalfClick={() => {}}
                        className="w-full"
                        ringColorClass="ring-[#E8480A]"
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (tokens)</FormLabel>
                    <FormControl>
                      <Input type="number" step="any" placeholder="0.00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="pricePerToken"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Stock price (USD)</FormLabel>
                    <FormControl>
                      <Input type="number" step="any" placeholder="0.00" {...field} />
                    </FormControl>

                    {usdPrice.data != null ? (
                      <FormDescription>
                        Live price: ${usdPrice.data.usdQuote.toFixed(2)} USD / token
                        {dirtyFields.pricePerToken && (
                          <Button
                            type="button"
                            variant="link"
                            className="pl-2 text-xs"
                            onClick={() =>
                              form.setValue("pricePerToken", usdPrice.data!.usdQuote, {
                                shouldValidate: true,
                                shouldDirty: true,
                              })
                            }
                          >
                            Use live price
                          </Button>
                        )}
                      </FormDescription>
                    ) : usdPrice.isFetching ? (
                      <FormDescription>Fetching live stock price...</FormDescription>
                    ) : usdPrice.isError ? (
                      <FormDescription>Couldn't load a live price — enter one manually.</FormDescription>
                    ) : null}

                    {currencyValue?.length === 3 &&
                      (localTotal != null ? (
                        <FormDescription>
                          ≈ {localTotal.toLocaleString()} {currencyValue.toUpperCase()} total
                          {amountValue > 0 ? ` for ${amountValue} tokens` : ""}
                        </FormDescription>
                      ) : quote.isFetching ? (
                        <FormDescription>Converting to {currencyValue.toUpperCase()}...</FormDescription>
                      ) : quote.isError ? (
                        <FormDescription>
                          No live conversion available for {currencyValue.toUpperCase()}.
                        </FormDescription>
                      ) : null)}

                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency (3-letter code)</FormLabel>
                  <FormControl>
                    <Input placeholder="NGN" maxLength={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="flutterwaveCredentialId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment account</FormLabel>
                  <FormControl>
                    <CredentialPicker side="buyer" value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {txStep === 1
                  ? "Approve in wallet..."
                  : txStep === 2
                  ? "Linking credential..."
                  : isSubmitting
                  ? "Creating..."
                  : "Create buy order"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
