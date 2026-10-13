import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:bg-[var(--color-text-muted)] disabled:text-white disabled:opacity-100 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)]",
        destructive: "bg-[var(--color-danger)] text-white hover:bg-red-700",
        outline:
          "border border-[var(--color-surface-2)] bg-white hover:bg-[var(--color-surface-2)] text-[var(--color-text-primary)]",
        secondary:
          "bg-[var(--color-accent)] text-[var(--color-text-primary)] hover:bg-[var(--color-accent-light)]",
        ghost: "hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]",
        link: "text-[var(--color-primary)] underline-offset-4 hover:underline",
        hero: "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] font-medium shadow-sm",
        accent:
          "bg-[var(--color-accent)] text-[var(--color-text-primary)] hover:bg-[var(--color-accent-light)] font-medium",
      },
      size: {
        default: "h-[52px] px-5 py-2",
        sm: "h-9 rounded-lg px-3 text-xs",
        lg: "h-[52px] rounded-xl px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
