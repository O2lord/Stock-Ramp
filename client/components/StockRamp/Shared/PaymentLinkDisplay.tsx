// client/components/StockRamp/Shared/PaymentLinkDisplay.tsx
// StockRamp's equivalent of TrustExpress's
// `components/TrustExpress/SellOrder/PaymentLinkDisplay.tsx`. Same polling
// strategy and state machine.
//
// TABLE/COLUMN NAMES: despite the "stock_ramp_*" naming this component used
// to have, the actual backend table is `payment_links` with the pubkey
// column still called `trust_express_address` — kept unrenamed on purpose
// (see supabase/migrations/0003_stock_ramp_operational_tables.sql's header,
// discord-bot/bot.ts's storePaymentLinkInDB/updatePaymentLinkStatus, and
// mcp-server/src/tools/paymentLinkLookup.ts's own note on this exact
// gotcha). This component was the one place in the repo that still assumed
// a renamed `stock_ramp_payment_links` table with a `stock_ramp_order`
// column — neither exists — so every sell-side payment-link reservation
// polled a table that would never have a row, and timed out with "Payment
// link generation timeout" even when the bot had already generated a
// working link and written it to `payment_links`. Fixed to match the real
// schema; the `stockRampOrder` prop name is unchanged (it's just this
// component's own API), only the Supabase table/column it's queried
// against changed. Everything else — the 3-strategy lookup (signature ->
// payout reference -> address), retry/backoff, expiry timer, OPay-popup vs.
// Flutterwave-tab handling, and status polling — is unchanged.

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, CheckCircle, Loader2, ExternalLink, AlertCircle, Clock, XCircle, ArrowLeft, CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';

interface StockRampPaymentLinkData {
  link_url: string;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  created_at: string;
  expires_at: string | null;
  payout_reference?: string;
}

interface PaymentLinkDisplayProps {
  payoutReference: string;
  transactionSignature?: string;
  /** base58 of the StockRampOrder PDA this reservation was made against —
   *  matched against the `payment_links` table's `trust_express_address`
   *  column (see file header for why that column name stuck around). */
  stockRampOrder: string;
  tokenSymbol?: string;
  tokenAmount: number;
  fiatAmount: number;
  currency: string;
  onPaymentComplete?: () => void;
  onBack?: () => void;
  onPaymentLinkReady?: (link: string) => void;
  onPaymentFailed?: () => void;
}

type PaymentStatus = 'loading' | 'ready' | 'completed' | 'expired' | 'failed' | 'error';

export const PaymentLinkDisplay: React.FC<PaymentLinkDisplayProps> = ({
  payoutReference,
  transactionSignature,
  stockRampOrder,
  tokenSymbol = '…',
  tokenAmount,
  fiatAmount,
  currency,
  onPaymentComplete,
  onBack,
  onPaymentLinkReady,
  onPaymentFailed,
}) => {
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [status, setStatus] = useState<PaymentStatus>('loading');
  const [copied, setCopied] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const expiryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const popupRef = useRef<Window | null>(null);
  const popupCheckRef = useRef<NodeJS.Timeout | null>(null);
  const fetchAttempts = useRef(0);
  const hasNotifiedReady = useRef(false);

  const isOpayLink = (url: string | null) =>
    !!url && (url.includes('opaycheckout.com') || url.includes('opayweb.com'));

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      if (expiryTimerRef.current) clearInterval(expiryTimerRef.current);
      if (popupCheckRef.current) clearInterval(popupCheckRef.current);
      if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
    };
  }, []);

  const openPaymentPopup = useCallback((url: string) => {
    const width = 480;
    const height = 700;
    const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
    const top = Math.round(window.screenY + (window.outerHeight - height) / 2);

    const popup = window.open(
      url,
      'opay_payment',
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
    );

    if (!popup) {
      toast.error('Popup blocked. Opening in new tab instead.');
      window.open(url, '_blank');
      return;
    }

    popupRef.current = popup;
    setPopupOpen(true);
    toast.info('Complete your payment in the popup window.');

    if (popupCheckRef.current) clearInterval(popupCheckRef.current);
    popupCheckRef.current = setInterval(() => {
      if (popup.closed) {
        clearInterval(popupCheckRef.current!);
        popupCheckRef.current = null;
        setPopupOpen(false);
        // Don't show error — payment_links polling below will detect
        // SUCCESS or timeout naturally.
      }
    }, 1000);
  }, []);

  useEffect(() => {
    fetchAttempts.current = 0;
    hasNotifiedReady.current = false;
    fetchPaymentLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payoutReference, transactionSignature, stockRampOrder]);

  const fetchPaymentLink = async () => {
    fetchAttempts.current++;

    try {
      let data: StockRampPaymentLinkData | null = null;

      // STRATEGY 1: by transaction signature — most specific.
      if (transactionSignature && transactionSignature !== 'undefined') {
        const { data: sigData, error: sigError } = await supabase
          .from('payment_links')
          .select('link_url, status, created_at, expires_at, payout_reference')
          .eq('transaction_signature', transactionSignature)
          .maybeSingle();

        if (sigError) {
          console.warn('[StockRamp PaymentLinkDisplay] Signature query error:', sigError);
        } else if (sigData) {
          data = sigData;
        }
      }

      // STRATEGY 2: by payout reference — very specific.
      if (!data) {
        const { data: refData, error: refError } = await supabase
          .from('payment_links')
          .select('link_url, status, created_at, expires_at, payout_reference')
          .eq('payout_reference', payoutReference.trim())
          .maybeSingle();

        if (refError) {
          console.error('[StockRamp PaymentLinkDisplay] Reference query error:', refError);
        } else if (refData) {
          data = refData;
        }
      }

      // STRATEGY 3: by stock ramp order — last resort, recent + pending only.
      // `trust_express_address` is the real column name for the StockRampOrder
      // pubkey — see file header.
      if (!data) {
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

        const { data: orderData, error: orderError } = await supabase
          .from('payment_links')
          .select('link_url, status, created_at, expires_at, payout_reference')
          .eq('trust_express_address', stockRampOrder)
          .eq('status', 'pending')
          .gte('created_at', twoMinutesAgo)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (orderError) {
          console.warn('[StockRamp PaymentLinkDisplay] Order query error:', orderError);
        } else if (orderData) {
          data = orderData;
        }
      }

      if (data) {
        handlePaymentLinkData(data);
        return;
      }

      const maxAttempts = 30;
      if (fetchAttempts.current < maxAttempts) {
        const baseDelay = 1000;
        const backoffFactor = 1.2;
        const maxDelay = 5000;
        const delay = Math.min(
          baseDelay * Math.pow(backoffFactor, Math.floor(fetchAttempts.current / 3)),
          maxDelay
        );
        setTimeout(fetchPaymentLink, delay);
      } else {
        setStatus('error');
        toast.error('Payment link generation timeout. Please refresh or contact support.');
      }
    } catch (error) {
      console.error('[StockRamp PaymentLinkDisplay] Exception in fetchPaymentLink:', error);
      if (fetchAttempts.current < 30) {
        setTimeout(fetchPaymentLink, 2000);
      } else {
        setStatus('error');
      }
    }
  };

  const handlePaymentLinkData = (data: StockRampPaymentLinkData) => {
    setPaymentLink(data.link_url);

    if (data.expires_at) {
      const expiryTime = new Date(data.expires_at).getTime();
      const now = Date.now();

      if (now > expiryTime) {
        setStatus('expired');
        return;
      }

      setTimeRemaining(Math.floor((expiryTime - now) / 1000));
      startExpiryTimer(expiryTime);
    }

    if (data.status === 'completed') {
      setStatus('completed');
      onPaymentComplete?.();
    } else if (data.status === 'failed') {
      setStatus('failed');
      onPaymentFailed?.();
    } else if (data.status === 'expired') {
      setStatus('expired');
    } else {
      setStatus('ready');

      if (!hasNotifiedReady.current && data.link_url) {
        hasNotifiedReady.current = true;
        onPaymentLinkReady?.(data.link_url);
      }

      startStatusPolling();
    }
  };

  const startExpiryTimer = (expiryTime: number) => {
    if (expiryTimerRef.current) clearInterval(expiryTimerRef.current);

    expiryTimerRef.current = setInterval(() => {
      const remaining = Math.floor((expiryTime - Date.now()) / 1000);

      if (remaining <= 0) {
        setTimeRemaining(0);
        setStatus('expired');
        if (expiryTimerRef.current) clearInterval(expiryTimerRef.current);
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      } else {
        setTimeRemaining(remaining);
      }
    }, 1000);
  };

  const startStatusPolling = () => {
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);

    let attempts = 0;
    const maxAttempts = 180;

    pollingIntervalRef.current = setInterval(async () => {
      attempts++;

      try {
        let query = supabase.from('payment_links').select('status');

        if (transactionSignature && transactionSignature !== 'undefined') {
          query = query.eq('transaction_signature', transactionSignature);
        } else {
          query = query.eq('payout_reference', payoutReference);
        }

        const { data, error } = await query.maybeSingle();

        if (error) {
          console.warn('[StockRamp PaymentLinkDisplay] Polling error:', error);
          return;
        }

        if (data?.status === 'completed') {
          setStatus('completed');
          if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
          if (expiryTimerRef.current) clearInterval(expiryTimerRef.current);
          // Parent decides what "completed" means for it (invalidate
          // queries, wait for a validator vote, show a receipt, etc.) —
          // we only surface the toast + status change here, same as
          // TrustExpress's PaymentLinkDisplay.
          toast.success('Payment received! Waiting for on-chain confirmation...');
          onPaymentComplete?.();
        } else if (data?.status === 'failed') {
          setStatus('failed');
          if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
          onPaymentFailed?.();
        }

        if (attempts >= maxAttempts) {
          if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        }
      } catch (error) {
        console.error('[StockRamp PaymentLinkDisplay] Error in status polling:', error);
      }
    }, 5000);
  };

  const copyToClipboard = useCallback(() => {
    if (paymentLink) {
      navigator.clipboard.writeText(paymentLink);
      setCopied(true);
      toast.success('Payment link copied!');
      setTimeout(() => setCopied(false), 2000);
    }
  }, [paymentLink]);

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <Loader2 className="w-7 h-7 animate-spin text-[#E8480A] mx-auto mb-3" />
          <p className="text-sm font-medium text-[#0F0D0A]" style={{ fontFamily: "'Syne', sans-serif" }}>
            Preparing your payment link...
          </p>
          {fetchAttempts.current > 5 && (
            <p className="text-[#E8480A] text-xs mt-2">Taking longer than expected... still trying</p>
          )}
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="p-5 bg-white border-2 border-[#0F0D0A]/10 rounded-xl">
        <div className="flex items-start gap-3">
          <div className="bg-[#E8480A]/10 p-2 rounded-lg flex-shrink-0">
            <AlertCircle className="w-5 h-5 text-[#E8480A]" />
          </div>
          <div>
            <p className="font-bold text-[#0F0D0A] text-sm" style={{ fontFamily: "'Syne', sans-serif" }}>
              Payment Link Error
            </p>
            <p className="text-xs text-[#0F0D0A]/50 mt-0.5 mb-3">
              Failed to load after {fetchAttempts.current} attempts.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={() => { fetchAttempts.current = 0; setStatus('loading'); fetchPaymentLink(); }}
                size="sm"
                className="bg-[#0F0D0A] text-white hover:bg-[#0F0D0A]/85 text-xs"
              >
                Try Again
              </Button>
              {onBack && (
                <Button onClick={onBack} variant="outline" size="sm" className="border-[#0F0D0A]/15 text-xs">
                  <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />Go Back
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="p-5 bg-white border-2 border-[#0F0D0A]/10 rounded-xl">
        <div className="flex items-start gap-3">
          <div className="bg-[#EDE8DF] p-2 rounded-lg flex-shrink-0">
            <Clock className="w-5 h-5 text-[#0F0D0A]/50" />
          </div>
          <div>
            <p className="font-bold text-[#0F0D0A] text-sm" style={{ fontFamily: "'Syne', sans-serif" }}>
              Payment Link Expired
            </p>
            <p className="text-xs text-[#0F0D0A]/50 mt-0.5 mb-3">
              This payment link has expired. Please create a new reservation.
            </p>
            {onBack && (
              <Button onClick={onBack} variant="outline" size="sm" className="border-[#0F0D0A]/15 text-xs">
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />Start Over
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="p-5 bg-white border-2 border-[#0F0D0A]/10 rounded-xl">
        <div className="flex items-start gap-3">
          <div className="bg-[#E8480A]/10 p-2 rounded-lg flex-shrink-0">
            <XCircle className="w-5 h-5 text-[#E8480A]" />
          </div>
          <div>
            <p className="font-bold text-[#0F0D0A] text-sm" style={{ fontFamily: "'Syne', sans-serif" }}>
              Payment Failed
            </p>
            <p className="text-xs text-[#0F0D0A]/50 mt-0.5 mb-3">
              The payment could not be processed. No funds were deducted.
            </p>
            {onBack && (
              <Button onClick={onBack} variant="outline" size="sm" className="border-[#0F0D0A]/15 text-xs">
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />Try Again
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (status === 'completed') {
    return (
      <div className="space-y-3">
        <div className="p-4 bg-white border-2 border-[#0F0D0A]/10 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="bg-[#0F0D0A] p-2 rounded-lg flex-shrink-0">
              <CheckCircle className="w-5 h-5 text-[#E8480A]" />
            </div>
            <div>
              <p className="font-bold text-[#0F0D0A]" style={{ fontFamily: "'Syne', sans-serif" }}>
                Payment Confirmed!
              </p>
              <p className="text-xs text-[#0F0D0A]/50 mt-0.5">
                Waiting for a validator to confirm and release on-chain.
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 bg-white border border-[#0F0D0A]/8 rounded-xl">
          <p className="text-xs font-bold uppercase tracking-widest text-[#0F0D0A]/40 mb-3"
             style={{ fontFamily: "'Syne', sans-serif" }}>
            Order Summary
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[#0F0D0A]/50">Tokens</span>
              <span className="font-semibold text-[#0F0D0A]">{tokenAmount} {tokenSymbol}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#0F0D0A]/50">You paid</span>
              <span className="font-semibold text-[#0F0D0A]">{currency} {fiatAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#0F0D0A]/50">Reference</span>
              <span className="font-mono text-xs text-[#0F0D0A]/60">{payoutReference}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Ready state — show payment link
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 px-4 py-3 bg-[#EDE8DF] rounded-xl border border-[#0F0D0A]/8">
        <Loader2 className="w-4 h-4 text-[#E8480A] animate-spin flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-[#0F0D0A]" style={{ fontFamily: "'Syne', sans-serif" }}>
            Waiting for Payment
          </p>
          <p className="text-xs text-[#0F0D0A]/50 mt-0.5">
            {isOpayLink(paymentLink)
              ? 'Click "Pay with OPay" — a payment window will open'
              : 'Click "Pay Now" below to complete your purchase'}
          </p>
        </div>
      </div>

      <div className="p-4 bg-white border border-[#0F0D0A]/8 rounded-xl">
        <p className="text-xs font-bold uppercase tracking-widest text-[#0F0D0A]/40 mb-3"
           style={{ fontFamily: "'Syne', sans-serif" }}>
          Order Summary
        </p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-[#0F0D0A]/50">Tokens</span>
            <span className="font-semibold text-[#0F0D0A]">{tokenAmount} {tokenSymbol}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#0F0D0A]/50">Total Cost</span>
            <span className="font-semibold text-[#0F0D0A]">{currency} {fiatAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#0F0D0A]/50">Reference</span>
            <span className="font-mono text-xs text-[#0F0D0A]/60">{payoutReference}</span>
          </div>
        </div>
      </div>

      <div className="p-4 bg-white border-2 border-[#0F0D0A]/10 rounded-xl">
        <div className="flex items-start gap-3 mb-3">
          <div className="bg-[#0F0D0A] p-2 rounded-lg flex-shrink-0">
            <CreditCard className="w-4 h-4 text-[#E8480A]" />
          </div>
          <div>
            <p className="font-bold text-[#0F0D0A] text-sm" style={{ fontFamily: "'Syne', sans-serif" }}>
              {isOpayLink(paymentLink) ? 'Pay via OPay' : 'Your Payment Link is Ready'}
            </p>
            <p className="text-xs text-[#0F0D0A]/50 mt-0.5">
              {isOpayLink(paymentLink)
                ? 'A secure OPay payment window will open. This page updates automatically when done.'
                : 'Click the button below to complete your payment securely.'}
            </p>
          </div>
        </div>

        {!isOpayLink(paymentLink) && (
          <div className="bg-[#EDE8DF] p-3 rounded-lg mb-3">
            <p className="text-xs text-[#0F0D0A]/50 break-all font-mono">{paymentLink}</p>
          </div>
        )}

        {isOpayLink(paymentLink) && popupOpen && (
          <div className="flex items-center gap-2 text-xs text-[#0F0D0A]/60 bg-[#EDE8DF] rounded-lg px-3 py-2 mb-3">
            <Loader2 className="w-3.5 h-3.5 text-[#E8480A] animate-spin flex-shrink-0" />
            Payment window is open — complete payment there
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={copyToClipboard}
            variant="outline"
            size="sm"
            className="flex-1 border-[#0F0D0A]/15 text-[#0F0D0A] text-xs"
            style={{ fontFamily: "'Syne', sans-serif" }}
          >
            {copied
              ? <><CheckCircle className="w-3.5 h-3.5 mr-1.5" />Copied!</>
              : <><Copy className="w-3.5 h-3.5 mr-1.5" />Copy Link</>}
          </Button>

          {isOpayLink(paymentLink) ? (
            <Button
              onClick={() => openPaymentPopup(paymentLink!)}
              disabled={popupOpen}
              size="sm"
              className="flex-1 bg-[#E8480A] hover:bg-[#E8480A]/85 text-white text-xs"
              style={{ fontFamily: "'Syne', sans-serif" }}
            >
              {popupOpen
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Window Open</>
                : <><CreditCard className="w-3.5 h-3.5 mr-1.5" />Pay with OPay</>}
            </Button>
          ) : (
            <Button
              onClick={() => window.open(paymentLink!, '_blank')}
              size="sm"
              className="flex-1 bg-[#0F0D0A] hover:bg-[#0F0D0A]/85 text-white text-xs"
              style={{ fontFamily: "'Syne', sans-serif" }}
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />Pay Now
            </Button>
          )}
        </div>
      </div>

      {timeRemaining !== null && timeRemaining > 0 && (
        <div className="flex items-center gap-2 text-xs text-[#0F0D0A]/40 px-1">
          <Clock className="w-3.5 h-3.5 flex-shrink-0" />
          Link expires in{' '}
          <span className="font-semibold text-[#0F0D0A]/60">{formatTime(timeRemaining)}</span>
        </div>
      )}

      {onBack && (
        <Button
          onClick={onBack}
          variant="ghost"
          size="sm"
          className="w-full text-[#0F0D0A]/50 hover:text-[#0F0D0A] text-xs"
        >
          <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />Back
        </Button>
      )}
    </div>
  );
};
