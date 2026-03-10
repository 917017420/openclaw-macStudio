import { forwardRef, type ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "border border-transparent bg-primary text-text-inverse shadow-sm hover:-translate-y-px hover:bg-primary-hover hover:shadow-md active:translate-y-0 active:shadow-sm",
  secondary:
    "border border-border bg-surface-2 text-text-primary shadow-sm hover:-translate-y-px hover:border-border-hover hover:bg-surface-3 hover:shadow-md active:translate-y-0 active:shadow-sm",
  ghost:
    "border border-transparent bg-transparent text-text-secondary hover:-translate-y-px hover:bg-surface-2 hover:text-text-primary hover:shadow-sm active:translate-y-0 active:shadow-none",
  danger:
    "border border-transparent bg-status-error text-white shadow-sm hover:-translate-y-px hover:opacity-95 hover:shadow-md active:translate-y-0 active:shadow-sm active:opacity-90",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs rounded-md gap-1.5",
  md: "px-4 py-2 text-sm rounded-lg gap-2",
  lg: "px-6 py-3 text-base rounded-lg gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", loading, className = "", children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center font-medium transition-all duration-150 cursor-pointer
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0
          ${variantStyles[variant]} ${sizeStyles[size]}
          ${disabled || loading ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}
          ${className}`}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg
            className="animate-spin -ml-1 h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
