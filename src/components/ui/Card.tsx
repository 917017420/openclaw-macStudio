import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: boolean;
  onClick?: () => void;
  active?: boolean;
}

export function Card({
  children,
  className = "",
  padding = true,
  onClick,
  active,
}: CardProps) {
  return (
    <div
      className={`rounded-xl border border-border bg-surface-0 transition-colors duration-150
        ${padding ? "p-4" : ""}
        ${onClick ? "cursor-pointer hover:border-border-hover hover:bg-surface-1" : ""}
        ${active ? "border-primary bg-primary-light" : ""}
        ${className}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
    >
      {children}
    </div>
  );
}
