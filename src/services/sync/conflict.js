export function classifyConflict(localMeta = {}, serverVersion = null) {
  if (!serverVersion) return "none";

  const lastSyncedVersion = Number.isFinite(localMeta.lastSyncedVersion)
    ? localMeta.lastSyncedVersion
    : 0;
  const dirty = Boolean(localMeta.dirty);

  if (dirty && serverVersion > lastSyncedVersion) return "diverged";
  if (dirty) return "local-ahead";
  if (serverVersion > lastSyncedVersion) return "server-ahead";
  return "none";
}
