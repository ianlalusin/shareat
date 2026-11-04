import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

describe("APK CORS preflight", () => {
  it("allows the operator-session header the financial commands send", () => {
    const res = middleware(
      new NextRequest("https://app.shareat.net/api/analytics/payment-conversion", {
        method: "OPTIONS",
        headers: { origin: "https://localhost" },
      })
    );
    const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    expect(allowed).toContain("x-pos-operator-session");
    expect(allowed).toContain("authorization");
  });
});
