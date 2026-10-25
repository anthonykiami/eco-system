import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/** Small shared building blocks so every page looks the same. Colors come from app/globals.css. */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass flex flex-col gap-4 rounded-3xl border border-line p-5 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {action && <div className="text-sm">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const BUTTON = {
  primary: "bg-accent text-accent-foreground shadow-[0_0_22px_-6px_rgba(94,230,168,0.7)] hover:brightness-110",
  secondary: "border border-line bg-surface-muted hover:bg-white/10",
  ghost: "text-muted hover:bg-surface-muted hover:text-foreground",
  danger: "border border-line bg-surface-muted text-danger hover:bg-danger-soft",
  /** An outlined pill that glows, like the hero's "Chat with ECO-SYSTEM". */
  glow: "border border-accent/50 bg-accent/10 text-foreground shadow-[0_0_24px_-8px_rgba(94,230,168,0.8)] hover:bg-accent/20",
} as const;

export type ButtonVariant = keyof typeof BUTTON;

export const buttonClass = (variant: ButtonVariant = "secondary", size: "sm" | "md" = "md") =>
  `inline-flex items-center justify-center gap-2 rounded-full font-medium transition disabled:opacity-50 ${
    size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-2 text-sm"
  } ${BUTTON[variant]}`;

export function Button({
  variant,
  size,
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return <button {...props} className={`${buttonClass(variant, size)} ${className}`} />;
}

export function LinkButton({
  variant,
  size,
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return <Link {...props} className={`${buttonClass(variant, size)} ${className}`} />;
}

const TONES = {
  neutral: "bg-surface-muted text-muted",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

/** A colored dot with a label, for status lines. */
export function Status({ tone, children }: { tone: Exclude<Tone, "neutral" | "accent">; children: ReactNode }) {
  const dot = { success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      {children}
    </span>
  );
}

/** A thin bar for "x of y" amounts. Turns amber past 80% and red at 100%. */
export function Meter({ value, label }: { value: number; label: string }) {
  const percent = Math.max(0, Math.min(100, value));
  const color = percent >= 100 ? "bg-danger" : percent >= 80 ? "bg-warning" : "bg-accent";
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full rounded-full ${color}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

export const inputClass =
  "w-full rounded-xl border border-line bg-black/25 px-3 py-2 text-sm outline-none transition placeholder:text-muted/70 focus:border-accent/60 focus:shadow-[0_0_0_3px_rgba(94,230,168,0.12)]";

/** Success or error notes shown after a form redirects back. */
export function Notice({ tone, children }: { tone: "success" | "danger"; children: ReactNode }) {
  return (
    <p
      role={tone === "danger" ? "alert" : "status"}
      className={`rounded-xl px-3 py-2 text-sm ${tone === "danger" ? "bg-danger-soft text-danger" : "bg-success-soft text-success"}`}
    >
      {children}
    </p>
  );
}
