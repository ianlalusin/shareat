import { describe, it, expect } from "vitest";
import {
  CHAT_RESPONSE_STANDARD_MS,
  computeFairResponseMs,
  isWithinStandard,
  computeChatScore,
  chatRatingLabel,
} from "./responseTiming";

describe("computeFairResponseMs", () => {
  it("measures from arrival when the responder was already on duty", () => {
    // arrived 10:00:00, responder on duty since 09:00, replied 10:01:30
    const arrival = 0;
    const onDutySince = -60 * 60 * 1000;
    const respondedAt = 90 * 1000;
    expect(computeFairResponseMs(arrival, onDutySince, respondedAt)).toBe(90 * 1000);
  });

  it("measures from the responder's on-duty start when they came on duty AFTER arrival", () => {
    // message arrived at t=0, sat unanswered, cashier 2 signed in at t=5min,
    // replied at t=5min30s -> fair time is 30s, not 5min30s
    const arrival = 0;
    const onDutySince = 5 * 60 * 1000;
    const respondedAt = 5 * 60 * 1000 + 30 * 1000;
    expect(computeFairResponseMs(arrival, onDutySince, respondedAt)).toBe(30 * 1000);
  });

  it("falls back to raw arrival time when there is no on-duty signal at all", () => {
    expect(computeFairResponseMs(0, null, 45_000)).toBe(45_000);
  });

  it("never goes negative", () => {
    expect(computeFairResponseMs(1000, 2000, 500)).toBe(0);
  });
});

describe("isWithinStandard", () => {
  it("is true at exactly the 2-minute standard", () => {
    expect(isWithinStandard(CHAT_RESPONSE_STANDARD_MS)).toBe(true);
  });
  it("is false one ms over", () => {
    expect(isWithinStandard(CHAT_RESPONSE_STANDARD_MS + 1)).toBe(false);
  });
});

describe("computeChatScore", () => {
  it("blends 80% timeliness + 20% efficiency", () => {
    expect(computeChatScore(100, 50)).toBe(90);
    expect(computeChatScore(50, 100)).toBe(60);
  });
  it("falls back to whichever side has a basis", () => {
    expect(computeChatScore(75, null)).toBe(75);
    expect(computeChatScore(null, 40)).toBe(40);
  });
  it("is null when neither side has a basis", () => {
    expect(computeChatScore(null, null)).toBeNull();
  });
});

describe("chatRatingLabel", () => {
  it.each([
    [0, "very poor"], [19.9, "very poor"],
    [20, "poor"], [39.9, "poor"],
    [40, "average"], [59.9, "average"],
    [60, "good"], [79.9, "good"],
    [80, "very good"], [100, "very good"],
  ])("scores %d as %s", (score, label) => {
    expect(chatRatingLabel(score)).toBe(label);
  });
});
