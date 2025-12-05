import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-6 w-6", className)}
    >
      <path d="M16.5 10.5c-1.2-1.2-2.8-2-4.5-2s-3.3.8-4.5 2" />
      <path d="M12 14.5c-1.2 0-2.3-.5-3.2-1.3" />
      <path d="M19 19c0-4-3-7-7-7s-7 3-7 7" />
      <title>SharEat Hub Logo</title>
    </svg>
  );
}
