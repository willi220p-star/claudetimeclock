import * as React from "react"
import { cn } from "cn"

// §15: inputs are 8px radius and 44px tall; the focus ring comes from the global :focus-visible rule.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-12 w-full min-w-0 rounded-md border border-input bg-card px-4 text-base transition-colors disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-ash aria-invalid:border-bad",
        className
      )}
      {...props}
    />
  )
}

export { Input }
