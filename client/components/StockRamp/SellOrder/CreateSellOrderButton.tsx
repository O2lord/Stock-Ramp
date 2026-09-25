// client/components/StockRamp/SellOrder/CreateSellOrderButton.tsx
// Trigger button + owns the open/close state for CreateSellOrderDialog.tsx.

"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateSellOrderDialog } from "./CreateSellOrderDialog";

export function CreateSellOrderButton() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="h-4 w-4" />
        New sell order
      </Button>
      <CreateSellOrderDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
