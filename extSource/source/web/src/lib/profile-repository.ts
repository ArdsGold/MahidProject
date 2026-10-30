import type { BusinessProfile, BusinessProfileInput } from "@backlink-autofill/shared";
import { createLocalStorageProfileRepository } from "./local-storage-repository";

/**
 * Persistence boundary for Business Profiles.
 *
 * Milestone 1 uses LocalStorageProfileRepository.
 * A Supabase implementation can replace it later without UI changes:
 * only getProfileRepository() needs to change.
 */
export interface BusinessProfileRepository {
  list(): Promise<BusinessProfile[]>;
  get(id: string): Promise<BusinessProfile | null>;
  create(input: BusinessProfileInput): Promise<BusinessProfile>;
  update(id: string, input: BusinessProfileInput): Promise<BusinessProfile>;
  delete(id: string): Promise<void>;
  setActive(id: string): Promise<BusinessProfile | null>;
  getActive(): Promise<BusinessProfile | null>;
}

export function getProfileRepository(): BusinessProfileRepository {
  // Milestone 1: local-only. Swap for a Supabase repository here later.
  return createLocalStorageProfileRepository();
}
