export function getManilaDayId(input?: Date | number | string | null): string {
  const date =
    input instanceof Date ? input :
    typeof input === "number" ? new Date(input) :
    typeof input === "string" ? new Date(input) :
    new Date();

  const safeDate = isNaN(date.getTime()) ? new Date() : date;

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Manila",
  }).format(safeDate).replace(/-/g, "");
}
