/**
 * Local project version history (autosave snapshots in localStorage).
 * Offline-first — not cloud revision history.
 */

const KEY = 'bmai-project-versions';
const MAX_PER_PROJECT = 12;
const MAX_PROJECTS = 40;

function readStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/** Push a lightweight snapshot (caller should pass a structuredClone of projectSnapshot). */
export function pushProjectVersion(projectId, snapshot, { label = 'Autosave' } = {}) {
  if (!projectId || !snapshot) return false;
  const store = readStore();
  const list = Array.isArray(store[projectId]) ? store[projectId] : [];
  const entry = {
    id: typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `ver-${Date.now()}`,
    at: Date.now(),
    label,
    snapshot
  };
  list.unshift(entry);
  store[projectId] = list.slice(0, MAX_PER_PROJECT);
  // Cap total projects tracked
  const ids = Object.keys(store);
  if (ids.length > MAX_PROJECTS) {
    ids
      .map(id => ({ id, at: store[id][0]?.at || 0 }))
      .sort((a, b) => a.at - b.at)
      .slice(0, ids.length - MAX_PROJECTS)
      .forEach(item => { delete store[item.id]; });
  }
  return writeStore(store);
}

export function listProjectVersions(projectId) {
  if (!projectId) return [];
  const store = readStore();
  return (store[projectId] || []).map(({ id, at, label }) => ({ id, at, label }));
}

export function getProjectVersion(projectId, versionId) {
  const store = readStore();
  return (store[projectId] || []).find(item => item.id === versionId) || null;
}

export function clearProjectVersions(projectId) {
  const store = readStore();
  delete store[projectId];
  return writeStore(store);
}
