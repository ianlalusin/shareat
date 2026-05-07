import { createHmac } from "crypto";

export interface JoinTokenPayload {
  s: string;  // storeId
  i: string;  // sessionId
  p: string;  // pin
  v: number;  // joinVersion
  e: number;  // exp (Unix seconds)
}

const SECRET = process.env.CUSTOMER_JOIN_TOKEN_SECRET!;
const CUSTOMER_ORIGIN = process.env.NEXT_PUBLIC_CUSTOMER_URL || "https://customer.shareat.net";

function sign(data: string): string {
  return createHmac("sha256", SECRET).update(data).digest().slice(0, 16).toString("base64url");
}

export function signJoinToken(payload: JoinTokenPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function buildJoinUrl(opts: {
  storeId: string;
  sessionId: string;
  pin: string;
  joinVersion: number;
  exp: number;
}): string {
  const payload: JoinTokenPayload = {
    s: opts.storeId,
    i: opts.sessionId,
    p: opts.pin,
    v: opts.joinVersion,
    e: Math.floor(opts.exp / 1000),
  };
  return `${CUSTOMER_ORIGIN}/join?t=${signJoinToken(payload)}`;
}
