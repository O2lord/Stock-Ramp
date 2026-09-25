import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Terminal-theme buttons. All variants run on tokens — no hex literals.
 *
 * The `default` variant previously hovered to `#0F0D0A` (near-black), which
 * on a near-black page made the primary CTA vanish on hover (visible on the
 * old landing page's "Get started"). It now hovers to `--primary-hover`,
 * which brightens the orange in dark mode and deepens it in light mode, so
 * the control stays visible either way.
 *
 * Accent discipline: at most one `default`/`primary` button per section.
 * Paired and secondary actions use `outline`; nav and icon buttons use
 * `ghost`.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        // Primary CTA — the orange. One per section, max.
        default:
          "bg-primary text-primary-foreground border border-primary hover:bg-primary-hover hover:border-primary-hover",
        // Secondary — filled neutral, important but not the loudest thing.
        secondary:
          "bg-surface-2 text-foreground border border-border hover:border-border-strong",
        // Outline — supporting / paired actions.
        outline:
          "border border-border-strong bg-transparent text-foreground hover:bg-surface-1 hover:border-foreground/40",
        // Ghost — nav items, icon buttons, tertiary.
        ghost:
          "bg-transparent text-muted-foreground hover:bg-surface-1 hover:text-foreground",
        // Destructive — outlined until committed to, then fills.
        destructive:
          "border border-destructive/40 bg-transparent text-destructive hover:bg-destructive hover:text-destructive-foreground hover:border-destructive",
        // Link
        link:
          "text-primary underline-offset-4 hover:underline p-0 h-auto",
        // Legacy alias — maps to default.
        gradient:
          "bg-primary text-primary-foreground border border-primary hover:bg-primary-hover hover:border-primary-hover",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
