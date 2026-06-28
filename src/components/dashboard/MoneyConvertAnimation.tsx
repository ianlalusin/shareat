"use client";

/**
 * MoneyConvertAnimation
 * ---------------------
 * A self-contained, dependency-free animation of *physical money* turning into
 * *digital money* and vice versa. Used by the dashboard "Convert Payment Mix"
 * flow to give the cashier a playful, tactile sense of which way value is
 * moving (e.g. GCash cashout = digital -> cash, or banking cash = cash ->
 * digital).
 *
 * No animation library — pure CSS keyframes injected once, plus lucide icons
 * that already ship with the app. Two modes:
 *   - "preview": gentle infinite loop that mirrors the current from/to choice.
 *   - "success": a one-shot celebratory burst, re-triggered via `playKey`.
 *
 * Direction is derived from the method names by the caller and passed in as
 * `direction`:
 *   - "toCash"    : digital money -> physical cash  (coins/bills land)
 *   - "toDigital" : physical cash -> digital money  (bills dematerialize)
 */

import { useEffect, useRef, useState } from "react";
import {
  Banknote,
  Coins,
  Smartphone,
  ArrowRight,
  Sparkles,
} from "lucide-react";

export type ConvertDirection = "toCash" | "toDigital";

interface MoneyConvertAnimationProps {
  direction: ConvertDirection;
  /** "preview" loops softly; "success" plays a single celebratory burst. */
  mode?: "preview" | "success";
  /** Bump this number to replay the success animation. */
  playKey?: number;
  /** Optional amount to pop in the centre (e.g. 5000 -> "₱5,000"). */
  amount?: number;
  /** Labels under each node, e.g. "GCash" and "Cash". */
  fromLabel?: string;
  toLabel?: string;
  /** Called once when a "success" run finishes. */
  onDone?: () => void;
  className?: string;
}

const STYLE_ID = "mca-money-convert-styles";

/** Inject the keyframes/CSS exactly once per document. */
function ensureStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

function pesoShort(n: number) {
  return `₱${Math.round(n).toLocaleString("en-US")}`;
}

export function MoneyConvertAnimation({
  direction,
  mode = "preview",
  playKey = 0,
  amount,
  fromLabel,
  toLabel,
  onDone,
  className = "",
}: MoneyConvertAnimationProps) {
  const [runId, setRunId] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    ensureStyles();
  }, []);

  // Re-mount the stage whenever a success replay is requested so every keyframe
  // restarts cleanly from 0.
  useEffect(() => {
    if (mode !== "success") return;
    setRunId((n) => n + 1);
    const t = window.setTimeout(() => doneRef.current?.(), 1900);
    return () => window.clearTimeout(t);
  }, [mode, playKey]);

  // Source/destination node identities. For "toCash" the value ends as physical
  // cash on the right; for "toDigital" it ends as digital on the right.
  const sourceIsCash = direction === "toDigital";
  const SourceIcon = sourceIsCash ? Banknote : Smartphone;
  const DestIcon = sourceIsCash ? Smartphone : Banknote;

  // Particle glyph: bills flutter when heading to/from cash, a coin spins for
  // extra bounce. We render a mix for a livelier feel.
  const particleCount = mode === "success" ? 7 : 4;
  const particles = Array.from({ length: particleCount });

  return (
    <div
      key={runId}
      className={`mca-stage mca-${mode} mca-dir-${direction} ${className}`}
      role="img"
      aria-label={
        direction === "toCash"
          ? "Digital money converting to cash"
          : "Cash converting to digital money"
      }
    >
      {/* Source node */}
      <div className="mca-node mca-node-source">
        <div className="mca-node-puck">
          <SourceIcon className="mca-node-icon" />
        </div>
        {fromLabel ? <span className="mca-node-label">{fromLabel}</span> : null}
      </div>

      {/* Flight path with flying money */}
      <div className="mca-track">
        <ArrowRight className="mca-track-arrow" />
        <div className="mca-particles">
          {particles.map((_, i) => {
            const isCoin = i % 3 === 1;
            const delay = (i * (mode === "success" ? 0.13 : 0.32)).toFixed(2);
            return (
              <span
                key={i}
                className={`mca-particle ${isCoin ? "mca-coin" : "mca-bill"}`}
                style={{ animationDelay: `${delay}s` }}
              >
                {isCoin ? (
                  <Coins className="mca-particle-icon" />
                ) : (
                  <Banknote className="mca-particle-icon" />
                )}
              </span>
            );
          })}
        </div>
      </div>

      {/* Destination node — pulses/pops when value "arrives" */}
      <div className="mca-node mca-node-dest">
        <div className="mca-node-puck">
          <DestIcon className="mca-node-icon" />
          {mode === "success" && (
            <Sparkles className="mca-burst" aria-hidden="true" />
          )}
        </div>
        {toLabel ? <span className="mca-node-label">{toLabel}</span> : null}
      </div>

      {/* Amount pops in the centre on success */}
      {mode === "success" && typeof amount === "number" && amount > 0 && (
        <div className="mca-amount" aria-hidden="true">
          {pesoShort(amount)}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Scoped CSS. All class names are prefixed `mca-` to avoid collisions, and the
 * block is injected a single time per document via ensureStyles().
 * ------------------------------------------------------------------------- */
const CSS = `
.mca-stage {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.25rem 0.25rem;
  overflow: visible;
  isolation: isolate;
}

/* ---- Nodes ---- */
.mca-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  z-index: 2;
}
.mca-node-puck {
  position: relative;
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 9999px;
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
  box-shadow: 0 1px 2px rgba(0,0,0,0.08), inset 0 0 0 1px hsl(var(--border));
}
.mca-node-icon { width: 1.4rem; height: 1.4rem; }
.mca-node-label {
  font-size: 0.7rem;
  line-height: 1;
  font-weight: 600;
  text-transform: capitalize;
  color: hsl(var(--muted-foreground));
  max-width: 5.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Cash side gets an emerald tint; digital side a sky/indigo tint. The arriving
   node "pops" to draw the eye. */
.mca-dir-toCash   .mca-node-dest   .mca-node-puck { background: hsl(152 60% 94%); color: hsl(152 64% 28%); box-shadow: inset 0 0 0 1px hsl(152 50% 80%); }
.mca-dir-toDigital .mca-node-dest  .mca-node-puck { background: hsl(214 95% 95%); color: hsl(221 70% 40%); box-shadow: inset 0 0 0 1px hsl(214 80% 84%); }

/* ---- Track ---- */
.mca-track {
  position: relative;
  height: 2.75rem;
  display: grid;
  place-items: center;
  overflow: visible;
}
.mca-track-arrow {
  width: 1.1rem; height: 1.1rem;
  color: hsl(var(--muted-foreground));
  opacity: 0.45;
}
.mca-particles {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.mca-particle {
  position: absolute;
  top: 50%;
  left: 0;
  display: grid;
  place-items: center;
  width: 1.05rem;
  height: 1.05rem;
  margin-top: -0.525rem;
  opacity: 0;
  will-change: transform, opacity;
}
.mca-particle-icon { width: 100%; height: 100%; }
.mca-bill .mca-particle-icon  { color: hsl(152 55% 42%); }
.mca-coin .mca-particle-icon  { color: hsl(43 90% 48%); }

/* ---- PREVIEW: gentle infinite loop ---- */
.mca-preview .mca-particle {
  animation: mca-fly-loop 1.9s cubic-bezier(.45,.05,.3,1) infinite;
}
.mca-preview .mca-coin {
  animation-name: mca-fly-loop-coin;
}
.mca-preview .mca-node-dest .mca-node-puck {
  animation: mca-pop-soft 1.9s ease-in-out infinite;
}

@keyframes mca-fly-loop {
  0%   { transform: translateX(0)    translateY(0) rotate(0deg)    scale(.7); opacity: 0; }
  12%  { opacity: 1; }
  50%  { transform: translateX(50%)  translateY(-6px) rotate(8deg) scale(1); opacity: 1; }
  88%  { opacity: 1; }
  100% { transform: translateX(100%) translateY(0) rotate(-4deg)   scale(.7); opacity: 0; }
}
@keyframes mca-fly-loop-coin {
  0%   { transform: translateX(0)    translateY(0)  rotateY(0deg)   scale(.6); opacity: 0; }
  15%  { opacity: 1; }
  50%  { transform: translateX(50%)  translateY(6px) rotateY(180deg) scale(1); opacity: 1; }
  85%  { opacity: 1; }
  100% { transform: translateX(100%) translateY(0)  rotateY(360deg) scale(.6); opacity: 0; }
}
@keyframes mca-pop-soft {
  0%, 70%, 100% { transform: scale(1); }
  84% { transform: scale(1.12); }
}

/* ---- SUCCESS: one-shot bouncy burst ---- */
.mca-success { animation: mca-stage-in .9s ease-out both; }
@keyframes mca-stage-in {
  0%   { transform: scale(.96); opacity: 0; }
  100% { transform: scale(1);   opacity: 1; }
}

.mca-success .mca-node-source .mca-node-puck {
  animation: mca-emit .7s cubic-bezier(.34,1.56,.64,1) both;
}
@keyframes mca-emit {
  0%   { transform: scale(1); }
  35%  { transform: scale(1.14) rotate(-6deg); }
  100% { transform: scale(1) rotate(0deg); }
}

.mca-success .mca-particle {
  animation: mca-fly-once 1.25s cubic-bezier(.5,-0.2,.3,1.4) both;
}
.mca-success .mca-coin { animation-name: mca-fly-once-coin; }

@keyframes mca-fly-once {
  0%   { transform: translateX(0)    translateY(0)   rotate(0deg)   scale(.5); opacity: 0; }
  18%  { opacity: 1; }
  60%  { transform: translateX(58%)  translateY(-10px) rotate(14deg) scale(1.1); opacity: 1; }
  100% { transform: translateX(100%) translateY(0)   rotate(0deg)   scale(.4); opacity: 0; }
}
@keyframes mca-fly-once-coin {
  0%   { transform: translateX(0)    translateY(0)  rotateY(0deg)   scale(.4); opacity: 0; }
  20%  { opacity: 1; }
  60%  { transform: translateX(55%)  translateY(10px) rotateY(220deg) scale(1.15); opacity: 1; }
  100% { transform: translateX(100%) translateY(0)  rotateY(360deg) scale(.4); opacity: 0; }
}

.mca-success .mca-node-dest .mca-node-puck {
  animation: mca-land 1.5s cubic-bezier(.34,1.56,.64,1) both;
}
@keyframes mca-land {
  0%, 55%   { transform: scale(1); }
  70%       { transform: scale(1.32) rotate(4deg); }
  84%       { transform: scale(0.94); }
  100%      { transform: scale(1); }
}

.mca-burst {
  position: absolute;
  width: 1rem; height: 1rem;
  top: -0.3rem; right: -0.3rem;
  color: hsl(43 92% 50%);
  opacity: 0;
  animation: mca-burst 1.5s ease-out both;
}
@keyframes mca-burst {
  0%, 58%  { opacity: 0; transform: scale(0) rotate(0deg); }
  72%      { opacity: 1; transform: scale(1.25) rotate(25deg); }
  100%     { opacity: 0; transform: scale(1.4) rotate(45deg); }
}

.mca-amount {
  position: absolute;
  left: 50%;
  top: -0.35rem;
  transform: translate(-50%, 0);
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  color: hsl(var(--foreground));
  text-shadow: 0 1px 0 hsl(var(--background));
  opacity: 0;
  animation: mca-amount 1.7s cubic-bezier(.34,1.56,.64,1) both;
  z-index: 3;
}
@keyframes mca-amount {
  0%, 50%  { opacity: 0; transform: translate(-50%, 6px) scale(.6); }
  66%      { opacity: 1; transform: translate(-50%, -10px) scale(1.1); }
  80%      { opacity: 1; transform: translate(-50%, -12px) scale(1); }
  100%     { opacity: 0; transform: translate(-50%, -18px) scale(1); }
}

/* Respect reduced-motion: hold the end state, skip the motion. */
@media (prefers-reduced-motion: reduce) {
  .mca-stage *, .mca-stage { animation: none !important; }
  .mca-particle { opacity: 0 !important; }
}
`;

export default MoneyConvertAnimation;
