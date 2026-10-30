import type { ProfileAssetRef } from "@backlink-autofill/shared";
import { createAssetRef } from "./profile-editor-logic";

export type ProfileAssetKind = "logo" | "brochure";
export const DRAFT_PROFILE_ID = "__draft-profile__";

export interface ProfileAssetStore {
  saveLogo(profileId: string, file: File): Promise<ProfileAssetRef>;
  getLogo(profileId: string, assetId: string): Promise<Blob | null>;
  removeLogo(profileId: string, assetId: string): Promise<void>;
  saveBrochure(profileId: string, file: File): Promise<ProfileAssetRef>;
  getBrochure(profileId: string, assetId: string): Promise<Blob | null>;
  removeBrochure(profileId: string, assetId: string): Promise<void>;
  claimAssetOwner(profileId: string, kind: ProfileAssetKind, assetId: string, allowedPreviousOwners: string[]): Promise<boolean>;
}

const DATABASE_NAME = "backlink-autofill-assets";
const STORE_NAME = "profile-assets";
const DATABASE_VERSION = 1;

interface StoredAsset {
  key: string;
  profileId: string;
  kind: ProfileAssetKind;
  assetId: string;
  blob: Blob;
}

function assetKey(_profileId: string, kind: ProfileAssetKind, assetId: string): string {
  return `${kind}:${assetId}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser does not support local file storage."));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local file storage."));
  });
}

function runRequest<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const request = operation(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Local file storage failed."));
        transaction.oncomplete = () => database.close();
        transaction.onerror = () => reject(transaction.error ?? new Error("Local file storage failed."));
      }),
  );
}

function createStoreMethod(kind: ProfileAssetKind, operation: "save" | "get" | "remove") {
  return async (profileId: string, value: File | string): Promise<ProfileAssetRef | Blob | null | void> => {
    const assetId = operation === "save" ? crypto.randomUUID() : value;
    const key = assetKey(profileId, kind, assetId as string);
    if (operation === "save") {
      const file = value as File;
      const ref: ProfileAssetRef = createAssetRef(file, assetId as string);
      await runRequest("readwrite", (store) => store.put({ key, profileId, kind, assetId, blob: file }));
      return ref;
    }
    if (operation === "get") {
      const stored = await runRequest<StoredAsset | undefined>("readonly", (store) => store.get(key));
      return stored?.blob ?? null;
    }
    await runRequest("readwrite", (store) => store.delete(key));
  };
}

export function createIndexedDbProfileAssetStore(): ProfileAssetStore {
  const saveLogo = createStoreMethod("logo", "save") as ProfileAssetStore["saveLogo"];
  const getLogo = createStoreMethod("logo", "get") as ProfileAssetStore["getLogo"];
  const removeLogo = createStoreMethod("logo", "remove") as ProfileAssetStore["removeLogo"];
  const saveBrochure = createStoreMethod("brochure", "save") as ProfileAssetStore["saveBrochure"];
  const getBrochure = createStoreMethod("brochure", "get") as ProfileAssetStore["getBrochure"];
  const removeBrochure = createStoreMethod("brochure", "remove") as ProfileAssetStore["removeBrochure"];
  async function claimAssetOwner(profileId: string, kind: ProfileAssetKind, assetId: string, allowedPreviousOwners: string[]): Promise<boolean> {
    const database = await openDatabase();
    return new Promise<boolean>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(assetKey(profileId, kind, assetId));
      request.onsuccess = () => {
        const stored = request.result as StoredAsset | undefined;
        if (!stored || stored.kind !== kind || stored.assetId !== assetId) { resolve(false); return; }
        if (stored.profileId === profileId) { resolve(true); return; }
        if (!allowedPreviousOwners.includes(stored.profileId)) { resolve(false); return; }
        store.put({ ...stored, profileId });
        resolve(true);
      };
      request.onerror = () => reject(request.error ?? new Error("Could not read profile asset ownership."));
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not repair profile asset ownership."));
    });
  }
  return { saveLogo, getLogo, removeLogo, saveBrochure, getBrochure, removeBrochure, claimAssetOwner };
}
