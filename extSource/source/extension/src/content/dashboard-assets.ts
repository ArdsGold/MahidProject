import { isDashboardOrigin } from './transport';
import type { ExtensionMessage, ProfileLogoResponse } from '../messages';

async function respondToProfileLogo(profileId: string, assetId: string, fileName: string): Promise<ProfileLogoResponse> {
  try {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("backlink-autofill-assets", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open profile asset storage."));
    });
    const stored = await new Promise<{ profileId: string; kind: string; assetId: string; blob: Blob } | undefined>((resolve, reject) => {
      const request = database.transaction("profile-assets", "readonly").objectStore("profile-assets").get(`logo:${assetId}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not read profile logo."));
    });
    database.close();
    const ownerDiagnostics = [`Active Profile ID: ${profileId}`, `Logo asset ID: ${assetId}`, `Asset owner ID: ${stored?.profileId || "missing"}`];
    if (!stored) return { ok: false, error: `Active Profile logo asset ${assetId} was not found in dashboard storage`, diagnostics: ownerDiagnostics };
    if (stored.profileId !== profileId || stored.kind !== "logo") return { ok: false, error: "Active Profile logo asset does not belong to the selected profile", diagnostics: ownerDiagnostics };
    if (!(stored.blob instanceof Blob)) return { ok: false, error: "Active Profile logo storage record has no valid binary Blob", diagnostics: [...ownerDiagnostics, "Ownership verified"] };
    const data = await stored.blob.arrayBuffer();
    return { ok: true, fileName: fileName || "business-logo", mimeType: stored.blob.type || "application/octet-stream", data: Array.from(new Uint8Array(data)), size: data.byteLength, diagnostics: [...ownerDiagnostics, "Ownership verified", "Business Logo retrieved", "Logo asset reference found", `Logo Blob loaded: ${(data.byteLength / 1024).toFixed(0)} KB ${stored.blob.type || "application/octet-stream"}`] };
  } catch (error) {
    return { ok: false, error: `Could not read Active Profile logo bytes: ${error instanceof Error ? error.message : "dashboard asset storage error"}` };
  }
}

async function respondToProfileBrochure(profileId: string, assetId: string, fileName: string): Promise<ProfileLogoResponse> {
  try {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("backlink-autofill-assets", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open profile asset storage."));
    });
    const stored = await new Promise<{ profileId: string; kind: string; assetId: string; blob: Blob } | undefined>((resolve, reject) => {
      const request = database.transaction("profile-assets", "readonly").objectStore("profile-assets").get(`brochure:${assetId}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not read profile brochure."));
    });
    database.close();
    const diagnostics = [`Active Profile ID: ${profileId}`, `Brochure asset ID: ${assetId}`, `Asset owner ID: ${stored?.profileId || "missing"}`];
    if (!stored) return { ok: false, error: "Brochure asset missing: Active Profile brochure was not found in dashboard storage", diagnostics };
    if (stored.profileId !== profileId || stored.kind !== "brochure") return { ok: false, error: "Active Profile brochure asset does not belong to the selected profile", diagnostics };
    if (!(stored.blob instanceof Blob)) return { ok: false, error: "Blob retrieval failed: Active Profile brochure storage record has no valid binary Blob", diagnostics: [...diagnostics, "Ownership verified"] };
    const data = await stored.blob.arrayBuffer();
    return { ok: true, fileName: fileName || "business-brochure.pdf", mimeType: stored.blob.type || "application/pdf", data: Array.from(new Uint8Array(data)), size: data.byteLength, diagnostics: [...diagnostics, "Ownership verified", "Brochure retrieved", `Brochure Blob loaded: ${(data.byteLength / 1024).toFixed(0)} KB ${stored.blob.type || "application/pdf"}`] };
  } catch (error) {
    return { ok: false, error: `Blob retrieval failed: ${error instanceof Error ? error.message : "dashboard asset storage error"}` };
  }
}


type AssetListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
const receiverState = globalThis as typeof globalThis & { __ba2DashboardAssetListener?: AssetListener };

// A standalone, idempotent reader: no profile sync, timers, autofill, or run recovery.
export function installDashboardAssetReceiver(): void {
  if (!isDashboardOrigin() || window.top !== window) return;
  const previous = receiverState.__ba2DashboardAssetListener;
  if (previous && chrome.runtime.onMessage.hasListener(previous)) return;
  const listener: AssetListener = (message: ExtensionMessage, _sender, sendResponse) => {
    if (!isDashboardOrigin() || window.top !== window) return undefined;
    if (message.type === 'BA2_GET_PROFILE_LOGO') {
      void respondToProfileLogo(message.profileId, message.assetId, message.fileName).then(sendResponse);
      return true;
    }
    if (message.type === 'BA2_GET_PROFILE_BROCHURE') {
      void respondToProfileBrochure(message.profileId, message.assetId, message.fileName).then(sendResponse);
      return true;
    }
    return undefined;
  };
  chrome.runtime.onMessage.addListener(listener);
  receiverState.__ba2DashboardAssetListener = listener;
}

installDashboardAssetReceiver();
