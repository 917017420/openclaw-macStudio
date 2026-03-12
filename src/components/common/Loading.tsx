import { getAppCopy } from "@/features/preferences/store";

interface LoadingProps {
  message?: string;
  size?: "sm" | "md" | "lg";
}

const sizeMap = {
  sm: "h-4 w-4",
  md: "h-8 w-8",
  lg: "h-12 w-12",
};

export function Loading({ message, size = "md" }: LoadingProps) {
  const copy = getAppCopy();
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8">
      <svg
        className={`animate-spin text-primary ${sizeMap[size]}`}
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
      <p className="text-sm text-text-secondary">{message ?? copy.common.loading}</p>
    </div>
  );
}
