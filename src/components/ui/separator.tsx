import { cn } from "@/lib/cn";

export function Separator({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("h-px w-full bg-border", className)} {...props} />;
}
