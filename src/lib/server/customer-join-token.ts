import { createHmac } from "crypto";

export interface JoinTokenPayload {
  storeId: string;
  sessionId: string;
  pin: string;
  joinVersion: number;
  exp: number;
}

const SECRET = process.env.CUSTOMER_JOIN_TOKEN_SECRET!;
const CUSTOMER_ORIGIN = process.env.NEXT_PUBLIC_CUSTOMER_URL || "https://customer.shareat.net";

export function signJoinToken(payload: JoinTokenPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function buildJoinUrl(payload: JoinTokenPayload): string {
  const token = signJoinToken(payload);
  return `${CUSTOMER_ORIGIN}/join?t=${token}`;
}
