import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4",
  {
    variants: {
      variant: {
        // Default: warm cream tinted info panel
        default:
          "bg-[#F5F0E8] border-[#0F0D0A]/15 text-[#0F0D0A] [&>svg]:text-[#E8480A] dark:bg-[#F5F0E8]/5 dark:border-[#F5F0E8]/10 dark:text-[#F5F0E8]",
        // Info: orange-tinted
        info:
          "bg-[#E8480A]/8 border-[#E8480A]/25 text-[#0F0D0A] [&>svg]:text-[#E8480A] dark:bg-[#E8480A]/10 dark:border-[#E8480A]/30 dark:text-[#F5F0E8]",
        // Destructive: red-tinted
        destructive:
          "bg-red-50 border-red-200 text-red-800 [&>svg]:text-red-600 dark:bg-red-900/20 dark:border-red-800/40 dark:text-red-300 dark:[&>svg]:text-red-400",
        // Success
        success:
          "bg-emerald-50 border-emerald-200 text-emerald-800 [&>svg]:text-emerald-600 dark:bg-emerald-900/20 dark:border-emerald-800/40 dark:text-emerald-300",
        // Warning
        warning:
          "bg-amber-50 border-amber-200 text-amber-800 [&>svg]:text-amber-600 dark:bg-amber-900/20 dark:border-amber-800/40 dark:text-amber-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn("mb-1 font-semibold leading-none tracking-tight", className)} {...props} />
  )
)
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-sm [&_p]:leading-relaxed opacity-85", className)} {...props} />
  )
)
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }