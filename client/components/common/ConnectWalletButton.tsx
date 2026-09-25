// client/components/common/ConnectWalletButton.tsx
// Ported from trust_vault's `components/ConnectWalletButton.tsx` — same
// connect/copy-address/change-wallet/disconnect dropdown, restyled onto
// stock-ramp's `Button`/`DropdownMenu` primitives (identical components,
// copied verbatim in `components/ui/*` per Todo.md).

"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export function ConnectWalletButton() {
  const { publicKey, connected, disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  if (!connected || !publicKey) {
    return <Button onClick={() => setVisible(true)}>Connect wallet</Button>;
  }

  const shortKey = `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">{shortKey}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => navigator.clipboard.writeText(publicKey.toBase58())}>
          Copy address
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setVisible(true)}>Change wallet</DropdownMenuItem>
        <DropdownMenuItem onClick={disconnect}>Disconnect</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
