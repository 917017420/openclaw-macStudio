import { forwardRef, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = "", id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s/g, "-");

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-text-primary"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`w-full px-3 py-2 text-sm rounded-lg
            bg-surface-1 border transition-colors duration-150
            text-text-primary placeholder:text-text-tertiary
            ${error ? "border-status-error focus:ring-status-error/30" : "border-border focus:border-primary focus:ring-primary/30"}
            focus:outline-none focus:ring-2
            ${className}`}
          {...props}
        />
        {error && <p className="text-xs text-status-error">{error}</p>}
        {hint && !error && <p className="text-xs text-text-tertiary">{hint}</p>}
      </div>
    );
  },
);

Input.displayName = "Input";
