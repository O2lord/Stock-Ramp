import * as React from "react"

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, ...props }, ref) => (
    <div
      ref={ref}
      className={`relative h-2 w-full overflow-hidden rounded-full bg-[#0F0D0A]/10 dark:bg-[#F5F0E8]/10 ${className}`}
      {...props}
    >
      <div
        className="h-full w-full flex-1 bg-[#E8480A] transition-all duration-500 ease-out rounded-full"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </div>
  )
)
Progress.displayName = "Progress"

export { Progress }