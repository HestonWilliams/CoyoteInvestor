import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-md border border-coyote-300 bg-white px-3 py-2 text-sm text-coyote-900 placeholder:text-coyote-400 focus:border-coyote-600 focus:outline-none focus:ring-1 focus:ring-coyote-600",
          className
        )}
        {...props}
      />
    );
  }
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-md border border-coyote-300 bg-white px-3 py-2 text-sm text-coyote-900 placeholder:text-coyote-400 focus:border-coyote-600 focus:outline-none focus:ring-1 focus:ring-coyote-600",
        className
      )}
      {...props}
    />
  );
});

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-coyote-700">
      {children}
    </label>
  );
}
