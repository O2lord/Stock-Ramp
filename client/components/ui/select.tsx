import * as React from "react";
import { cn } from "@/lib/utils";
import TokenDisplay from "./token-display";

export interface TokenInfo {
  mint: string;
  balance: number;
  /**
   * Display symbol, e.g. "AAPLx". When provided (as it is for every entry
   * built from `XSTOCKS_MINTS` — see hooks/useXStocksTokenList.ts), this is
   * used directly instead of a live metadata lookup: the devnet stand-in
   * mints aren't indexed by Jupiter's token list, so `useTokenMetadata`
   * would never resolve them (see that hook's docstring).
   */
  symbol?: string;
  logoURI?: string;
}

export interface TokenSelectProps {
  tokens: TokenInfo[];
  onTokenChange: (token: TokenInfo | null) => void;
  onMaxClick: (balance: number) => void;
  onHalfClick: (balance: number) => void;
  className?: string;
  ringColorClass?: string;
  /** Optional controlled value — pass the mint address to pre-select a token */
  value?: string;
  /**
   * Show the Max/Half quick-fill buttons next to the balance readout.
   * Defaults to true. Turn off for flows where "amount" isn't balance-
   * constrained — e.g. a buy order's amount is how many tokens the maker
   * wants to buy, not tokens they currently hold.
   */
  showBalanceActions?: boolean;
}

const TokenSelect: React.FC<TokenSelectProps> = ({
  tokens,
  onTokenChange,
  onMaxClick,
  onHalfClick,
  className,
  ringColorClass,
  value,
  showBalanceActions = true,
}) => {
  const [selectedToken, setSelectedToken] = React.useState<TokenInfo | null>(
    () => (value ? (tokens.find((t) => t.mint === value) ?? null) : null)
  );

  // Sync when `value` changes (e.g. from prefill) or when `tokens` first loads
  React.useEffect(() => {
    if (!value) return;
    const match = tokens.find((t) => t.mint === value) ?? null;
    if (match && match.mint !== selectedToken?.mint) {
      setSelectedToken(match);
      onTokenChange(match);
    }
  }, [value, tokens]);

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedMint = event.target.value;
    const token = tokens.find((t) => t.mint === selectedMint) ?? null;
    setSelectedToken(token);
    onTokenChange(token);
  };

  return (
    <div>
      {selectedToken && (
        <div className="absolute right-7 top-2 flex items-center space-x-2">
          <TokenDisplay
            logoURI={selectedToken.logoURI}
            amount={selectedToken.balance.toFixed(2)}
            symbol={selectedToken.symbol}
          />
          {showBalanceActions && (
            <>
              <button
                type="button"
                className="px-2 py-1 text-xs text-[#FFFFFF] bg-[#E8480A] hover:opacity-90 rounded transition-opacity"
                onClick={() => onMaxClick(parseFloat(Number(selectedToken.balance).toFixed(2)))}
              >
                Max
              </button>
              <button
                type="button"
                className="px-2 py-1 text-xs text-[#0F0D0A] bg-[#EDE8DF] hover:bg-[#E2DAC8] border border-[rgba(15,13,10,0.12)] rounded transition-colors"
                onClick={() => onHalfClick(parseFloat(Number(selectedToken.balance).toFixed(2)))}
              >
                Half
              </button>
            </>
          )}
        </div>
      )}

      <select
        className={cn(
          "relative rounded-lg border border-[rgba(15,13,10,0.12)] p-3 bg-[#EDE8DF] text-[#0F0D0A] focus-within:border-[#E8480A] focus:outline-none focus:ring-2 focus:ring-[#E8480A]/20 transition-colors",
          ringColorClass,
          className
        )}
        value={selectedToken?.mint ?? ""}
        onChange={handleChange}
      >
        <option value="" disabled className="bg-[#F5F0E8] text-[rgba(15,13,10,0.5)]">
          Select a token
        </option>
        {tokens.map((token) => (
          <option key={token.mint} value={token.mint} className="bg-[#EDE8DF] text-[#0F0D0A]">
            {token.symbol ?? `${token.mint.slice(0, 4)}...${token.mint.slice(-4)}`}
          </option>
        ))}
      </select>
    </div>
  );
};

TokenSelect.displayName = "TokenSelect";

export { TokenSelect };
