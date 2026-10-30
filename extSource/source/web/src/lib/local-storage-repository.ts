import {
  createActiveProfilePayload,
  createEmptyProfileInput,
  normalizeBusinessProfile,
  STORAGE_KEYS,
  type BusinessProfile,
  type BusinessProfileInput,
} from "@backlink-autofill/shared";
import type { BusinessProfileRepository } from "./profile-repository";

function readStore<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStore(key: string, value: unknown): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function createLocalStorageProfileRepository(): BusinessProfileRepository {
  function readProfiles(): BusinessProfile[] {
    const raw = readStore<unknown[]>(STORAGE_KEYS.profiles, []);
    return raw
      .map((entry) => normalizeBusinessProfile(entry))
      .filter((entry): entry is BusinessProfile => entry !== null);
  }

  function writeProfiles(profiles: BusinessProfile[]): void {
    writeStore(STORAGE_KEYS.profiles, profiles);
    mirrorActiveProfile(profiles);
  }

  function mirrorActiveProfile(profiles: BusinessProfile[]): void {
    const activeId = readStore<string | null>(STORAGE_KEYS.activeProfileId, null);
    const active = profiles.find((profile) => profile.id === activeId) ?? null;
    if (active) {
      writeStore(STORAGE_KEYS.activeProfile, createActiveProfilePayload(active, "local-storage"));
    } else {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(STORAGE_KEYS.activeProfile);
      }
    }
  }

  async function setActive(id: string): Promise<BusinessProfile | null> {
    const profiles = readProfiles();
    const active = profiles.find((profile) => profile.id === id) ?? null;
    if (!active) {
      return null;
    }
    writeStore(STORAGE_KEYS.activeProfileId, id);
    mirrorActiveProfile(profiles);
    return active;
  }

  return {
    async list() {
      return readProfiles().sort((a, b) => a.businessName.localeCompare(b.businessName));
    },

    async get(id) {
      return readProfiles().find((profile) => profile.id === id) ?? null;
    },

    async create(input: BusinessProfileInput) {
      const now = new Date().toISOString();
      const profile: BusinessProfile = {
        ...createEmptyProfileInput(),
        ...input,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      const profiles = readProfiles();
      profiles.push(profile);
      writeProfiles(profiles);
      const activeId = readStore<string | null>(STORAGE_KEYS.activeProfileId, null);
      if (!activeId) {
        return (await setActive(profile.id)) ?? profile;
      }
      return profile;
    },

    async update(id, input) {
      const profiles = readProfiles();
      const index = profiles.findIndex((profile) => profile.id === id);
      if (index === -1) {
        throw new Error(`Business Profile not found: ${id}`);
      }
      const updated: BusinessProfile = {
        ...profiles[index],
        ...input,
        id,
        updatedAt: new Date().toISOString(),
      };
      profiles[index] = updated;
      writeProfiles(profiles);
      return updated;
    },

    async delete(id) {
      const profiles = readProfiles().filter((profile) => profile.id !== id);
      writeProfiles(profiles);
      const activeId = readStore<string | null>(STORAGE_KEYS.activeProfileId, null);
      if (activeId === id) {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(STORAGE_KEYS.activeProfileId);
        }
        mirrorActiveProfile(profiles);
      }
    },

    async setActive(id) {
      return setActive(id);
    },

    async getActive() {
      const activeId = readStore<string | null>(STORAGE_KEYS.activeProfileId, null);
      if (!activeId) {
        return null;
      }
      return readProfiles().find((profile) => profile.id === activeId) ?? null;
    },
  };
}
