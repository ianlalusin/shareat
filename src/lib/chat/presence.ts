export type PresenceEvent = {
  profileId: string;
  profileName: string;
  event: "signin" | "signout";
  atClientMs: number;
};

/**
 * Who was on duty at `atMs`, replaying a store's presence-event log in order.
 * A device has one active local profile at a time, so this is a straight
 * chronological replay, not an interval-overlap problem.
 */
export function resolveOnDutyAt(
  events: PresenceEvent[],
  atMs: number,
): { profileId: string; profileName: string } | null {
  const relevant = events
    .filter((e) => e.atClientMs <= atMs)
    .sort((a, b) => a.atClientMs - b.atClientMs);
  let current: { profileId: string; profileName: string } | null = null;
  for (const e of relevant) {
    if (e.event === "signin") current = { profileId: e.profileId, profileName: e.profileName };
    else if (e.event === "signout" && current?.profileId === e.profileId) current = null;
  }
  return current;
}

/**
 * The start (ms) of `profileId`'s current on-duty stretch as of `atMs`, or
 * null if they weren't on duty at `atMs`. Used to fairly clock a responder's
 * OWN elapsed time — never from before they were actually on duty.
 */
export function resolveOnDutySince(
  events: PresenceEvent[],
  profileId: string,
  atMs: number,
): number | null {
  const relevant = events
    .filter((e) => e.profileId === profileId && e.atClientMs <= atMs)
    .sort((a, b) => a.atClientMs - b.atClientMs);
  let since: number | null = null;
  for (const e of relevant) {
    since = e.event === "signin" ? e.atClientMs : null;
  }
  return since;
}
