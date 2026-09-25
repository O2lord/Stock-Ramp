// client/components/StockRamp/BuyOrder/CreateBuyButton.tsx
// Trigger button + owns the open/close state for CreateBuyDialog.tsx.

"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateBuyDialog } from "./CreateBuyDialog";

export function CreateBuyButton() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="h-4 w-4" />
        New buy order
      </Button>
      <CreateBuyDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
