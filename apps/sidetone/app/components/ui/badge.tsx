import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva("enamel-badge", {
  variants: {
    variant: {
      neutral: "",
      success: "",
      warning: "",
      danger: "",
      primary: "",
      accent: ""
    }
  },
  defaultVariants: {
    variant: "neutral"
  }
});

type Variant = "neutral" | "success" | "warning" | "danger" | "primary" | "accent";

export function Badge({
  className,
  variant = "neutral",
  ...props
}: Omit<React.ComponentProps<"div">, "color"> & VariantProps<typeof badgeVariants>) {
  return (
    <div
      data-variant={(variant ?? "neutral") as Variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}
