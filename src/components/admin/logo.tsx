import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-6 w-6", className)}
    >
      <title>SharEat Hub Logo</title>
      <circle cx="50" cy="50" r="50" fill="black" />
      <g stroke="white" strokeWidth="4">
        <line x1="25" y1="40" x2="75" y2="30" />
        <line x1="20" y1="55" x2="80" y2="45" />
        <line x1="15" y1="70" x2="85" y2="60" />
      </g>
      <path
        d="M 60 15 C 30 30, 70 70, 40 85"
        stroke="hsl(var(--primary))"
        strokeWidth="10"
        fill="none"
        strokeLinecap="round"
      />
      <g fill="hsl(var(--primary))">
        <circle cx="65" cy="27" r="6" />
        <circle cx="59" cy="38" r="3" />
        <circle cx="41" cy="62" r="3" />
        <circle cx="35" cy="73" r="6" />
      </g>
    </svg>
  );
}
