
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 100"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-6 w-6", className)}
      aria-labelledby="logoTitle"
    >
      <title id="logoTitle">SharEat Hub Logo</title>
      <g fontFamily="sans-serif" fontWeight="bold">
        {/* SE logo */}
        <text
          x="50%"
          y="45"
          dominantBaseline="middle"
          textAnchor="middle"
          fontSize="48"
        >
          <tspan fill="black">S</tspan>
          <tspan fill="hsl(var(--primary))">E</tspan>
        </text>

        {/* SharEat Hub text */}
        <text
          x="50%"
          y="80"
          dominantBaseline="middle"
          textAnchor="middle"
          fontSize="20"
        >
          <tspan fill="black">Shar</tspan>
          <tspan fill="hsl(var(--primary))">Eat Hub</tspan>
        </text>
      </g>
    </svg>
  );
}
