import {
  normalizeBusinessProfile,
  STORAGE_KEYS,
  type ActiveProfilePayload,
  type BusinessProfile,
} from "@backlink-autofill/shared";

/**
 * Extension profile transport.
 *
 * Milestone 1: the dashboard (web app) stores the active profile payload in
 * localStorage under STORAGE_KEYS.activeProfile. The content script running on
 * the dashboard origin mirrors that payload into chrome.storage.local under the
 * same key. Every extension surface (popup, background, content) reads the
 * active profile through this module only.
 *
 * Future: a Supabase-backed dashboard or background sync writes the same
 * chrome.storage.local contract, so no consumer here changes.
 */

export function isDashboardOrigin(): boolean {
  return (
    typeof location !== "undefined" &&
    (location.origin === "http://localhost:3000" || location.origin === "http://127.0.0.1:3000")
  );
}

function parsePayload(raw: unknown): ActiveProfilePayload | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const profile = normalizeBusinessProfile(record.profile);
  if (!profile) {
    return null;
  }
  return {
    profile,
    syncedAt: typeof record.syncedAt === "string" ? record.syncedAt : "",
    source: record.source === "supabase" ? "supabase" : "local-storage",
  };
}

export async function getActiveProfilePayload(savedNamesOnly = false): Promise<ActiveProfilePayload | null> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.activeProfile);
  const payload = parsePayload(data[STORAGE_KEYS.activeProfile]);
  if (payload && savedNamesOnly) {
    // The legacy normalizer derives missing personal names from the business.
    // Smart fallback must use saved personal data only; never write this view back.
    const raw = data[STORAGE_KEYS.activeProfile]?.profile;
    payload.profile.firstName = typeof raw?.firstName === 'string' ? raw.firstName : '';
    payload.profile.lastName = typeof raw?.lastName === 'string' ? raw.lastName : '';
  }
  return payload;
}

export async function getActiveProfile(savedNamesOnly = false): Promise<BusinessProfile | null> {
  const payload = await getActiveProfilePayload(savedNamesOnly);
  return payload?.profile ?? null;
}

export async function setActiveProfilePayload(payload: ActiveProfilePayload): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.activeProfile]: payload });
}

export async function clearActiveProfile(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.activeProfile);
}

/**
 * Reads the payload mirrored by the dashboard page (page localStorage is
 * shared with content scripts on the dashboard origin) and stores it in
 * chrome.storage.local. Returns the validated profile, or null.
 */
export async function syncFromDashboardPage(): Promise<BusinessProfile | null> {
  if (!isDashboardOrigin()) {
    return getActiveProfile();
  }
  const raw = window.localStorage.getItem(STORAGE_KEYS.activeProfile);
  if (!raw) {
    await clearActiveProfile();
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const payload = parsePayload(parsed);
  if (!payload) {
    return null;
  }
  await setActiveProfilePayload(payload);
  return payload.profile;
}
