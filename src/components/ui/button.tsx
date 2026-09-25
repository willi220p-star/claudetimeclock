import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// §15: pill buttons, 44px minimum; the focus ring comes from the global :focus-visible rule.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-[1584px] border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-bad [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary:
          "border-border bg-secondary text-secondary-foreground hover:bg-muted aria-expanded:bg-muted",
        outline:
          "border-border bg-secondary text-secondary-foreground hover:bg-muted aria-expanded:bg-muted",
        ghost: "text-primary hover:bg-muted aria-expanded:bg-muted",
        destructive: "bg-bad text-primary-foreground hover:bg-bad/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-11 px-5",
        sm: "min-h-11 px-4",
        lg: "min-h-16 px-8 text-lg",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
