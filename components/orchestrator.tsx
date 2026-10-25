import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The dashboard's centerpiece: the main agent as a glowing world in the middle, with the other
 * agents, memory and tasks orbiting it on paths of light. Each node opens its page.
 */

export type OrbitNode = {
  key: string;
  label: string;
  sub: string;
  href: string;
  color: "green" | "blue" | "teal" | "violet";
  icon: ReactNode;
};

const COLORS = {
  green: { ring: "#5ee6a8", glow: "rgba(94,230,168,0.55)", fill: "rgba(20,70,48,0.85)" },
  blue: { ring: "#6aa8ff", glow: "rgba(106,168,255,0.55)", fill: "rgba(18,40,78,0.85)" },
  teal: { ring: "#4fd8e8", glow: "rgba(79,216,232,0.55)", fill: "rgba(14,58,66,0.85)" },
  violet: { ring: "#b18cff", glow: "rgba(177,140,255,0.55)", fill: "rgba(44,26,80,0.85)" },
} as const;

/** Viewbox the paths are drawn in; nodes are placed in the same space, as percentages. */
const W = 640;
const H = 440;
const CX = W / 2;
const CY = H / 2 + 6;

function place(i: number, n: number) {
  // Spread around an ellipse, starting at the top and leaving the bottom-center to the label.
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 3) + (n === 2 ? Math.PI / 4 : 0);
  return { x: CX + Math.cos(angle) * 255, y: CY + Math.sin(angle) * 168 };
}

export function Orchestrator({ center, nodes }: { center: { name: string; href: string }; nodes: OrbitNode[] }) {
  const shown = nodes.slice(0, 6);
  const points = shown.map((_, i) => place(i, shown.length));
  return (
    <div className="relative mx-auto aspect-[640/440] w-full max-w-[640px]">
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <filter id="orbit-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="orbit-line" x1="0" x2="1">
            <stop offset="0%" stopColor="#5ee6a8" stopOpacity="0.05" />
            <stop offset="50%" stopColor="#5ee6a8" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#4fd8e8" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        {/* Orbits */}
        <ellipse cx={CX} cy={CY} rx={255} ry={168} fill="none" stroke="rgba(255,255,255,0.07)" strokeDasharray="2 6" />
        <ellipse cx={CX} cy={CY} rx={300} ry={120} fill="none" stroke="url(#orbit-line)" strokeWidth="1.4" filter="url(#orbit-glow)" transform={`rotate(-8 ${CX} ${CY})`} />
        <ellipse cx={CX} cy={CY} rx={220} ry={190} fill="none" stroke="url(#orbit-line)" strokeWidth="1" opacity="0.6" filter="url(#orbit-glow)" transform={`rotate(14 ${CX} ${CY})`} />
        {/* A curved path of light from the center to each node */}
        {points.map((p, i) => {
          const mx = (CX + p.x) / 2 + (p.y - CY) * 0.25;
          const my = (CY + p.y) / 2 - (p.x - CX) * 0.25;
          const c = COLORS[shown[i].color];
          return (
            <path key={shown[i].key} d={`M${CX},${CY} Q${mx},${my} ${p.x},${p.y}`} fill="none" stroke={c.ring} strokeOpacity="0.55" strokeWidth="1.3" filter="url(#orbit-glow)" />
          );
        })}
        {/* Sparks */}
        {[
          [150, 60], [470, 90], [560, 300], [90, 330], [380, 400], [250, 380], [520, 180], [110, 170],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 2.6 : 1.6} fill="#c9ffe3" opacity="0.8" filter="url(#orbit-glow)" />
        ))}
      </svg>

      {/* The main agent */}
      <Link
        href={center.href}
        className="absolute top-1/2 left-1/2 flex aspect-square w-[30%] -translate-x-1/2 -translate-y-[47%] flex-col items-center justify-center rounded-full text-center transition hover:scale-[1.02]"
        style={{
          background:
            "radial-gradient(circle at 35% 30%, rgba(190,255,220,0.35), transparent 30%), radial-gradient(circle at 50% 55%, #1f6b46 0%, #0d3a26 45%, #04160d 75%)",
          boxShadow: "0 0 60px 10px rgba(94,230,168,0.28), inset 0 0 40px rgba(94,230,168,0.35), inset 0 0 0 1px rgba(160,255,210,0.25)",
        }}
      >
        <span className="text-[clamp(10px,1.6vw,15px)] font-medium tracking-[0.3em] text-white/95">{center.name.toUpperCase()}</span>
        <span className="mt-0.5 text-[clamp(10px,1.2vw,13px)] text-white/70">Orchestrator</span>
        <span className="mt-2 flex h-3 items-end gap-[3px]" aria-hidden>
          {[5, 9, 12, 7, 11, 6, 9, 4].map((h, i) => (
            <span key={i} className="w-[2px] animate-pulse rounded-full bg-accent" style={{ height: h, animationDelay: `${i * 120}ms` }} />
          ))}
        </span>
      </Link>

      {/* The orbiting nodes */}
      {shown.map((node, i) => {
        const p = points[i];
        const c = COLORS[node.color];
        // Nodes above the center put their label above the circle, so it never runs into the orb.
        const above = p.y < CY - 40;
        return (
          <Link
            key={node.key}
            href={node.href}
            className={`group absolute flex w-36 items-center text-center ${above ? "flex-col-reverse" : "flex-col"}`}
            style={{
              left: `${(p.x / W) * 100}%`,
              top: `${(p.y / H) * 100}%`,
              transform: above ? "translate(-50%, calc(-100% + 28px))" : "translate(-50%, -28px)",
            }}
          >
            <span
              className="flex h-14 w-14 items-center justify-center rounded-full text-white transition group-hover:scale-110"
              style={{ background: `radial-gradient(circle at 40% 30%, ${c.glow}, ${c.fill} 70%)`, boxShadow: `0 0 26px -2px ${c.glow}, inset 0 0 0 1.5px ${c.ring}` }}
            >
              {node.icon}
            </span>
            <span className={`flex flex-col ${above ? "mb-1.5" : "mt-1.5"}`}>
              <span className="text-sm font-medium">{node.label}</span>
              <span className="line-clamp-2 text-[11px] leading-snug text-muted">{node.sub}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
