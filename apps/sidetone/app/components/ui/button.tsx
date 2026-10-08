"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-md border font-semibold outline-none transition disabled:pointer-events-none disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default:
          "border-crimson-500 bg-crimson-500 text-cream-100 hover:border-crimson-600 hover:bg-crimson-600 active:border-crimson-700 active:bg-crimson-700 disabled:border-crimson-100 disabled:bg-crimson-100 disabled:text-cream-100",
        secondary:
          "border-foreground/60 bg-transparent text-foreground hover:border-foreground hover:bg-foreground hover:text-background active:bg-foreground/90",
        secondaryOnCream:
          "border-navy-800 bg-transparent text-navy-800 hover:bg-navy-800 hover:text-cream-100 active:bg-navy-700 disabled:border-cream-300 disabled:text-cream-300",
        ghost:
          "border-transparent bg-transparent text-muted-foreground hover:border-cream-200/45 hover:bg-cream-100/10 hover:text-foreground",
        ghostOnCream:
          "border-transparent bg-transparent text-navy-800 hover:text-crimson-500 hover:underline active:text-crimson-700 disabled:text-cream-300",
        liveAction:
          "border-amber-500 bg-amber-500 text-navy-800 hover:border-amber-600 hover:bg-amber-600",
        accent:
          "border-amber-500 bg-amber-500 text-navy-800 hover:border-amber-600 hover:bg-amber-600",
        danger:
          "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90"
      },
      size: {
        default: "h-11 px-5 text-[15px] leading-5",
        sm: "h-9 px-3 text-sm",
        lg: "h-12 px-5 text-[15px] leading-5",
        icon: "size-11 px-0"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
