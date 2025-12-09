import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-6 w-6", className)}
    >
      <title>SharEat Logo</title>
      <defs>
        <path
          id="curvedTextPath"
          d="M 50 100 A 50 50, 0, 1, 1, 150 100"
          fill="none"
        />
      </defs>

      {/* Outer Brush Stroke */}
      <path
        d="M 195,100 C 195,152.467 152.467,195 100,195 C 47.533,195 5,152.467 5,100 C 5,47.533 47.533,5 100,5 C 152.467,5 195,47.533 195,100 Z"
        stroke="black"
        strokeWidth="18"
        fill="none"
        strokeLinecap="round"
        transform="rotate(20 100 100)"
      />

      {/* Flag elements */}
      <g>
        {/* Central black circle */}
        <circle cx="100" cy="100" r="40" fill="black" />
        
        {/* White stripes */}
        <g stroke="white" strokeWidth="4">
            <line x1="75" y1="88" x2="125" y2="88" />
            <line x1="75" y1="100" x2="125" y2="100" />
            <line x1="75" y1="112" x2="125" y2="112" />
        </g>
        
        {/* Red S-curve */}
        <path d="M100 70 C 120 80, 80 120, 100 130" stroke="hsl(var(--primary))" strokeWidth="12" fill="none" strokeLinecap="round" />
        
        {/* Red dots */}
        <g fill="hsl(var(--primary))">
            <circle cx="92" cy="78" r="4" />
            <circle cx="108" cy="122" r="4" />
            <circle cx="98" cy="100" r="4" />
        </g>

        {/* Trigrams */}
        <g fill="black">
          {/* Top-left */}
          <g transform="translate(60, 60) rotate(-45 10 10)">
            <rect x="0" y="0" width="20" height="4" />
            <rect x="0" y="7" width="20" height="4" />
            <rect x="0" y="14" width="20" height="4" />
          </g>
          {/* Top-right */}
          <g transform="translate(120, 60) rotate(45 10 10)">
            <rect x="0" y="0" width="9" height="4" />
            <rect x="11" y="0" width="9" height="4" />
            <rect x="0" y="7" width="20" height="4" />
            <rect x="0" y="14" width="9" height="4" />
            <rect x="11" y="14" width="9" height="4" />
          </g>
          {/* Bottom-left */}
          <g transform="translate(60, 120) rotate(45 10 10)">
            <rect x="0" y="0" width="20" height="4" />
            <rect x="0" y="7" width="9" height="4" />
            <rect x="11" y="7" width="9" height="4" />
            <rect x="0" y="14" width="20" height="4" />
          </g>
          {/* Bottom-right */}
          <g transform="translate(120, 120) rotate(-45 10 10)">
             <rect x="0" y="0" width="9" height="4" />
            <rect x="11" y="0" width="9" height="4" />
            <rect x="0" y="7" width="9" height="4" />
            <rect x="11" y="7" width="9" height="4" />
            <rect x="0" y="14" width="9" height="4" />
            <rect x="11" y="14" width="9" height="4" />
          </g>
        </g>
      </g>

      {/* Text */}
      <text
        fontFamily="Arial, sans-serif"
        fontWeight="bold"
        fontSize="16"
        letterSpacing="1.5"
        fill="black"
        style={{fontVariantCaps: "all-small-caps"}}
      >
        <textPath href="#curvedTextPath" startOffset="50%" textAnchor="middle">
          Unlimited Samgyupsal
        </textPath>
      </text>
      
      <text
        x="100"
        y="160"
        fontFamily="Arial, sans-serif"
        fontWeight="bold"
        fontSize="18"
        textAnchor="middle"
        fill="black"
      >
        SharEat
      </text>
    </svg>
  );
}
