import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="eyebrow">
      <span className="eyebrow-dot" aria-hidden="true" />
      {children}
    </p>
  );
}

/** Pill CTA with the trailing icon nested in its own circle. */
export function PillLink({
  href,
  children,
  variant = "primary",
  icon,
  external = false,
  label,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
  icon?: ReactNode;
  external?: boolean;
  label?: string;
}) {
  return (
    <a
      className={`pill pill-${variant}`}
      href={href}
      data-magnetic
      aria-label={label}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <span className="pill-text">{children}</span>
      <span className="pill-icon" aria-hidden="true">
        {icon ?? <ArrowUpRight size={16} strokeWidth={1.5} />}
      </span>
    </a>
  );
}

/** Splits a line into masked characters for the staggered heading reveal. */
export function SplitLine({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <span className={`split-line ${className}`}>
      {Array.from(text).map((char, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: characters repeat; position is the identity.
          key={index}
          className="split-char"
        >
          {char === " " ? " " : char}
        </span>
      ))}
    </span>
  );
}

/** Text whose characters light up one by one as the reader scrolls. */
export function ScrubText({ text }: { text: string }) {
  return (
    <>
      {Array.from(text).map((char, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: characters repeat; position is the identity.
        <span key={index} className="scrub-char">
          {char}
        </span>
      ))}
    </>
  );
}

/** Double-bezel enclosure: a hairline tray holding an inset core. */
export function Bezel({
  children,
  className = "",
  coreClassName = "",
}: {
  children: ReactNode;
  className?: string;
  coreClassName?: string;
}) {
  return (
    <div className={`bezel ${className}`}>
      <div className={`bezel-core ${coreClassName}`}>{children}</div>
    </div>
  );
}
