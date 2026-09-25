import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Terminal-theme input — sits at surface-2 (one step above cards so fields
 * read as recessed targets inside a card), hairline border, orange focus
 * ring. Previously hardcoded `bg-white` + `#0F0D0A` borders with `dark:`
 * overrides; tokens handle both modes now, so the branches are gone.
 */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md px-3 py-2 text-sm",
          "bg-surface-2 border border-input text-foreground placeholder:text-muted-foreground",
          "transition-colors hover:border-border-strong",
          "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary",
          "ring-offset-background",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
