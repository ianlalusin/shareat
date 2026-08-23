import { describe, it, expect } from "vitest";
import { manilaDayAnchor, anchorYmd, anchorDayId, anchorDayOfWeek } from "@/lib/analytics/manila-day";

/**
 * The forecast cron fires at 05:00–09:00 Asia/Manila. The 05:00, 06:00 and
 * 07:00 fires all land on the PREVIOUS UTC calendar date, and the generator
 * used server-local (UTC) dates while analytics docs are keyed to Manila — so
 * forecasts were written for yesterday through day+5 and the freshest complete
 * day was dropped from the history window.
 *
 * These cases are that bug, expressed as tests.
 */
describe("manilaDayAnchor", () => {
  it("resolves the 05:00 Manila cron fire to TODAY in Manila, not yesterday in UTC", () => {
    // 2026-08-22T21:00Z is 2026-08-23 05:00 in Manila.
    expect(anchorYmd(manilaDayAnchor(Date.parse("2026-08-22T21:00:00Z")))).toBe("2026-08-23");
  });

  it("agrees with the later fires that were already landing correctly", () => {
    // 09:00 Manila = 01:00Z the same calendar day.
    expect(anchorYmd(manilaDayAnchor(Date.parse("2026-08-23T01:00:00Z")))).toBe("2026-08-23");
  });

  it("holds the Manila date right up to Manila midnight", () => {
    expect(anchorYmd(manilaDayAnchor(Date.parse("2026-08-23T15:59:59Z")))).toBe("2026-08-23"); // 23:59 Manila
    expect(anchorYmd(manilaDayAnchor(Date.parse("2026-08-23T16:00:00Z")))).toBe("2026-08-24"); // 00:00 Manila
  });

  it("anchors at UTC midnight so arithmetic and formatting are machine-independent", () => {
    const d = manilaDayAnchor(Date.parse("2026-08-22T21:00:00Z"));
    expect(d.toISOString()).toBe("2026-08-23T00:00:00.000Z");
  });
});

describe("anchor formatters", () => {
  const d = manilaDayAnchor(Date.parse("2026-08-22T21:00:00Z")); // Manila 2026-08-23

  it("formats both shapes the rest of the app uses", () => {
    expect(anchorYmd(d)).toBe("2026-08-23");
    expect(anchorDayId(d)).toBe("20260823");
  });

  it("reads the weekday in Manila terms", () => {
    // 2026-08-23 is a Sunday.
    expect(anchorDayOfWeek(d)).toBe(0);
  });

  it("gives the Manila weekday even when UTC is still on the previous day", () => {
    // Same instant: UTC says Saturday, Manila says Sunday. The generator maps
    // the model's weekday names back to dates with this, so it must be Manila's.
    expect(new Date("2026-08-22T21:00:00Z").getUTCDay()).toBe(6); // Saturday, UTC
    expect(anchorDayOfWeek(d)).toBe(0); // Sunday, Manila
  });
});
