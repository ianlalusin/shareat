/**
 * Resolve who performed a logged action, preferring the device-local profile
 * (cashier/KDS/server local user) over the shared Firebase account. Staff share
 * one account/email, so the local profile name + id are the meaningful identity
 * for attribution and grouping.
 */
type ActorFields = {
  serverProfileId?: string | null;
  serverProfileName?: string | null;
  actorUid?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
};

/** Stable grouping key — the local profile when present, else the account uid. */
export function logActorKey(log: ActorFields): string {
  const pid = (log.serverProfileId ?? "").trim();
  if (pid) return `lp:${pid}`;
  return (log.actorUid ?? "").trim() || "unknown";
}

/** Display name — local profile name first, then the account name/role. */
export function logActorName(log: ActorFields): string {
  return (
    (log.serverProfileName ?? "").trim() ||
    (log.actorName ?? "").trim() ||
    (log.actorRole ?? "").trim() ||
    "System"
  );
}
