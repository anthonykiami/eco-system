/** The ECO-SYSTEM mark: a glowing leaf-orb. */
export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <defs>
        <radialGradient id="eco-orb" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#c9ffe3" />
          <stop offset="45%" stopColor="#4fd99a" />
          <stop offset="100%" stopColor="#0d5a3a" />
        </radialGradient>
        <filter id="eco-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#eco-glow)">
        <path d="M24 4c11 0 20 9 20 20S35 44 24 44C18 38 10 30 10 21 10 12 16 6 24 4Z" fill="url(#eco-orb)" />
        <path d="M17 33c4-9 10-15 19-19" stroke="#03130b" strokeOpacity="0.55" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`font-medium tracking-[0.32em] ${className}`}>ECO-SYSTEM</span>;
}
