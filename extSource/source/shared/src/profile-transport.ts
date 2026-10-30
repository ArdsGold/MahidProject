import type { BusinessProfile } from "./business-profile.ts";

/**
 * Transport contract between the dashboard and the Chrome extension.
 *
 * Milestone 1 source of truth: browser localStorage in the dashboard origin.
 * The extension content script mirrors the active profile from the dashboard's
 * localStorage into chrome.storage.local under ACTIVE_PROFILE_KEY.
 * A future Supabase transport writes the same chrome.storage.local contract.
 */
export const STORAGE_KEYS = {
  profiles: "ba2.profiles",
  activeProfileId: "ba2.activeProfileId",
  activeProfile: "ba2.activeProfile",
  captureJob: "ba2.captureJob",
} as const;

export interface ActiveProfilePayload {
  profile: BusinessProfile;
  syncedAt: string;
  source: "local-storage" | "supabase";
}

export function createActiveProfilePayload(
  profile: BusinessProfile,
  source: ActiveProfilePayload["source"] = "local-storage",
): ActiveProfilePayload {
  return {
    profile,
    syncedAt: new Date().toISOString(),
    source,
  };
}
