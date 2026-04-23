import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ButtonProps) {
  const variants: Record<Variant, string> = {
    primary: "bg-coyote-700 text-white hover:bg-coyote-800 disabled:bg-coyote-400",
    secondary:
      "bg-white text-coyote-800 border border-coyote-300 hover:bg-coyote-50 disabled:text-coyote-400",
    ghost: "text-coyote-700 hover:bg-coyote-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  const sizes: Record<Size, string> = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-sm",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
