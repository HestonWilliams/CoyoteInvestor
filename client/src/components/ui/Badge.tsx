import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "blue";
  className?: string;
}) {
  const tones = {
    neutral: "bg-coyote-100 text-coyote-800",
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
    blue: "bg-blue-100 text-blue-800",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function statusTone(status: string): "neutral" | "green" | "amber" | "red" | "blue" {
  switch (status) {
    case "active":
    case "funded":
    case "paid":
    case "completed":
      return "green";
    case "fundraising":
    case "committed":
    case "approved":
    case "open":
      return "blue";
    case "prospecting":
    case "draft":
    case "pending":
      return "amber";
    case "exited":
    case "closed":
      return "neutral";
    default:
      return "neutral";
  }
}
