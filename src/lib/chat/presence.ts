export type PresenceEvent = {
  profileId: string;
  profileName: string;
  event: "signin" | "signout";
  atClientMs: number;
};

/**
 * Orders presence events chronologically, breaking a same-millisecond tie by
 * putting `signout` before `signin`.
 *
 * A handover writes both halves of the pair in one go, so the two events
 * routinely land on the IDENTICAL `atClientMs`. Sorting on the timestamp alone
 * left those ties to be broken by whatever order Firestore happened to return
 * the docs in, which could flip a handover into "signin then signout" and make
 * it look like NOBODY was on duty. Signout-first is the only reading that keeps
 * a same-instant handover meaningful.
 *
 * Kept a total order (equal events compare 0) rather than a bare ternary: an
 * inconsistent comparator has implementation-defined output in Array#sort,
 * which is exactly the nondeterminism this exists to remove.
 */
function byTimeThenSignoutFirst(a: PresenceEvent, b: PresenceEvent): number {
  return a.atClientMs - b.atClientMs || (a.event === b.event ? 0 : a.event === "signout" ? -1 : 1);
}

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
    .sort(byTimeThenSignoutFirst);
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
    .sort(byTimeThenSignoutFirst);
  let since: number | null = null;
  for (const e of relevant) {
    since = e.event === "signin" ? e.atClientMs : null;
  }
  return since;
}
