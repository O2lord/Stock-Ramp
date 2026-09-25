// client/components/StockRamp/SellOrder/CreateSellOrderDialog.tsx
// Form dialog wrapping `create_sell_order.rs` via `useStockRampProgram().createSellOrder`.
// Validated client-side with `schemas/sellOrderSchema.ts` (mirrors the exact
// on-chain constraints in `utils.rs::validate_order_fields` / `parse_currency`).
// Unlike a buy order, creating a sell order transfers `amount` tokens from the
// seller's own ATA into escrow immediately — the wallet's SPL transaction
// will simply fail if the balance is insufficient, so there's no separate
// client-side balance check here. Payout instructions are no longer
// collected here — payment routes through the seller's registered
// credential id instead.
//
// UNITS: "Amount (tokens)" is typed in whole tokens; `create_sell_order`'s
// `amount` argument is in the mint's BASE UNITS — it's passed straight into
// `transfer_tokens` and then stored as the order's available `amount`, which
// instant_sell_reserve later subtracts base-unit reservations from. Scale via
// lib/tokenAmount.ts::toBaseUnits. (Sending the unscaled figure is what made
// the buy-side equivalent underflow with AnchorError 6017 ArithmeticOverflow;
// here it would instead have escrowed ~1e-6 of the intended deposit.)
//
// Token is picked via `TokenSelect` (components/ui/select.tsx — the same
// picker trust_vault's CreateBuyDialog uses), populated from the static
// `XSTOCKS_MINTS` stand-in map with each mint's on-chain balance for the
// connected wallet (see hooks/useXStocksTokenList.ts) rather than a raw
// mint-address text field. Unlike CreateBuyDialog, the Max/Half quick-fill
// buttons are left on (`showBalanceActions` defaults to true) since this
// "amount" *is* balance-constrained — it's exactly what gets transferred
// into escrow on submit. Those balances are UI amounts, so they feed the
// form field directly and get scaled at submit like anything else.
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
// `currency` (see utils.rs::validate_order_fields / create_sell_order.rs) —
// never USD — and is quoted per WHOLE token, so unlike `amount` it is
// deliberately not scaled by decimals. At submit time the USD figure the
// maker sees/edited is converted via that same FX ratio into the per-token
// value actually sent to the program. Submission is blocked (with a toast)
// if a live FX rate for the entered currency hasn't resolved yet, since
// there'd be nothing correct to convert with.
//
// `flutterwaveCredentialId` is picked from the maker's saved payment-processor
// accounts (Flutterwave/OPay/Paystack — see hooks/usePaymentProcessorCredentials.ts
// and app/stocks/merchant/settings/page.tsx) via the same `CredentialPicker`
// CreateBuyDialog uses, just on the "seller" side — this is the account the
// maker gets paid INTO once a taker's fiat payment is confirmed.
//
// Two-step submit, mirroring trust_vault's CreateExpressSellDialog pattern:
// step 1 is the actual on-chain create_sell_order call (which also escrows
// the tokens); step 2 is a separate, off-chain `linkToOrder` call that
// records the credential<->order link in sell_order_credentials (see
// supabase/migrations/0007_order_credential_links.sql). If step 2 fails, we
// only warn — the order is already live on-chain (tokens already escrowed)
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
import { sellOrderSchema, type SellOrderFormValues } from "@/schemas/sellOrderSchema";
import { CredentialPicker } from "@/components/StockRamp/Shared/CredentialPicker";

interface CreateSellOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateSellOrderDialog({ open, onOpenChange }: CreateSellOrderDialogProps) {
  const { createSellOrder, findStockRampOrderPda, connection } = useStockRampProgram();
  const { publicKey } = useWallet();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  // 0 = idle, 1 = on-chain create (+ escrow deposit) in flight, 2 = off-chain credential link in flight
  const [txStep, setTxStep] = React.useState<0 | 1 | 2>(0);

  const tokens = useXStocksTokenList(publicKey);
  const { allCredentials, linkToOrder } = usePaymentProcessorCredentials("seller");

  const form = useForm<SellOrderFormValues>({
    resolver: zodResolver(sellOrderSchema),
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

  async function onSubmit(values: SellOrderFormValues) {
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

      // Whole tokens -> base units, matching what actually moves into escrow.
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

      // Step 1: the actual on-chain create (escrows the tokens too).
      // flutterwaveCredentialId is already an on-chain argument here, so the
      // order is fully valid and usable even if step 2 below never runs.
      setTxStep(1);
      await createSellOrder({
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
            "Failed to link credential to sell order, but the order was created on-chain:",
            linkError
          );
        }
      }

      queryClient.invalidateQueries({ queryKey: stockRampAccountsQueryKey() });
      toast({
        title: "Sell order created",
        description: `Offering ${values.amount} tokens at ${chainPricePerToken} ${values.currency} ($${values.pricePerToken} USD)`,
      });
      form.reset();
      onOpenChange(false);
    } catch (err) {
      const parsed = parseAnchorError(err);
      toast({ title: "Couldn't create sell order", description: parsed.message, variant: "destructive" });
    } finally {
      setTxStep(0);
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create sell order</DialogTitle>
          <DialogDescription>
            Deposit xStocks tokens into escrow now. Buyers will pay you fiat via your configured
            payout method before tokens are released to them.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="mint"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Token to sell</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <TokenSelect
                        tokens={tokens}
                        value={field.value}
                        onTokenChange={(token) => field.onChange(token?.mint ?? "")}
                        onMaxClick={(balance) =>
                          form.setValue("amount", balance, { shouldValidate: true, shouldDirty: true })
                        }
                        onHalfClick={(balance) =>
                          form.setValue("amount", balance / 2, { shouldValidate: true, shouldDirty: true })
                        }
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
                    <CredentialPicker side="seller" value={field.value} onChange={field.onChange} />
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
                  ? "Depositing..."
                  : "Create sell order"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
