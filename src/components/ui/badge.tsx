import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Badge({
  className,
  tone = "neutral",
  children,
  ...rest
}: {
  className?: string;
  tone?: "neutral" | "holding" | "weakening" | "broken" | "untested" | "primary";
  children: ReactNode;
} & Omit<ComponentProps<"span">, "className" | "children">) {
  const tones: Record<string, string> = {
    neutral: "bg-muted text-muted-foreground",
    holding: "bg-holding/15 text-holding",
    weakening: "bg-weakening/15 text-weakening",
    broken: "bg-broken/15 text-broken",
    untested: "bg-muted text-muted-foreground",
    primary: "bg-primary/10 text-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium uppercase tracking-wider",
        tones[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
