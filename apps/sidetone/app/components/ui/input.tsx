import * as React from "react";
import { cn } from "../../lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-11 w-full min-w-0 rounded-md border-[1.5px] border-[#DDD0B6] bg-[#FCF9F2] px-4 py-2 text-base text-[#0A192F] outline-none transition placeholder:text-[#6E83A0] hover:border-[#C7B891] focus-visible:border-[#D22B2B] focus-visible:ring-2 focus-visible:ring-[#D22B2B]/15 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:bg-[#EDE4D1] disabled:text-[#9CABBE] disabled:opacity-70",
        className
      )}
      {...props}
    />
  );
}
