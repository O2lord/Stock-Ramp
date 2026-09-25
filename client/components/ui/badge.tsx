import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Terminal-theme badge — squared off (no `rounded-full` pill), hairline
 * border, tinted fill. Every variant is token-driven, so there are no
 * `dark:` branches: the tokens already flip.
 *
 * `up` / `down` exist for price and order-direction labelling and use the
 * dedicated price-action tokens rather than success/warning, which carry
 * different meaning (a sell order is not a warning).
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-primary/40 bg-primary/10 text-primary",
        secondary:
          "border-border-strong bg-surface-2 text-muted-foreground",
        outline:
          "border-border-strong bg-transparent text-muted-foreground",
        up:
          "border-up/40 bg-up/10 text-up",
        down:
          "border-down/40 bg-down/10 text-down",
        success:
          "border-up/40 bg-up/10 text-up",
        warning:
          "border-amber-500/40 bg-amber-500/10 text-amber-500",
        destructive:
          "border-destructive/40 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
