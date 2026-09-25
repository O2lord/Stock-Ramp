import * as React from "react"
import { cn } from "@/lib/utils"

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-md px-3 py-2 text-sm",
          "bg-white border border-[#0F0D0A]/20 text-[#0F0D0A] placeholder:text-[#0F0D0A]/35",
          "dark:bg-[#0F0D0A]/40 dark:border-[#F5F0E8]/15 dark:text-[#F5F0E8] dark:placeholder:text-[#F5F0E8]/35",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8480A]/60 focus-visible:border-[#E8480A]",
          "ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "resize-none",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }