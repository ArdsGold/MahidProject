import { readListingRun, updateListingRun, LISTING_RUN_KEY, type ListingRun } from "./listing-run";
import { directory3PublicUrl, directory3ReceiptKey, type Directory3Receipt, type Directory3Review, type Directory3Outcome, type Directory3Submission } from "./automation/directory3-submission";

const operations = new Map<string, Promise<unknown>>();
const profileReceiptKey = (id: string) => `ba2.directory3.profileReceipt:${id}`;
const failure = (reason: string) => ({ ok: false as const, reason });
export async function directory3Locked<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const previous = operations.get(id) || Promise.resolve();
  const next = previous.catch(() => undefined).then(operation); operations.set(id, next);
  try { return await next; } finally { if (operations.get(id) === next) operations.delete(id); }
}
async function boundRun(runId: string) {
  const run = await readListingRun();
  if (!run || run.id !== runId || run.domain !== "directory3.org") throw Error("Current Directory3 run required");
  const tab = await chrome.tabs.get(run.tabId);
  if (!tab.url || new URL(tab.url).origin !== new URL(run.sourceUrl).origin) throw Error("Directory3 tab/origin changed");
  return run;
}
function trustedContent(run: ListingRun, sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.frameId === 0 && sender.tab?.id === run.tabId && !!sender.url && new URL(sender.url).origin === new URL(run.sourceUrl).origin;
}
export async function digestDirectory3Material(material: unknown, sender: chrome.runtime.MessageSender) {
  const run = await readListingRun();
  if (!run || run.domain !== "directory3.org" || !trustedContent(run, sender) || typeof material !== "string" || material.length > 131072) return failure("Untrusted digest request");
  const tab = await chrome.tabs.get(run.tabId);
  if (!tab.url || sender.url !== tab.url) return failure("Digest source changed");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return { ok: true as const, digest: [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("") };
}
async function inspect(run: ListingRun) {
  let response;
  try { response = await chrome.tabs.sendMessage(run.tabId, { type: "BA2_D3_INSPECT" }, { frameId: 0 }); }
  catch (error) { if (!/receiving end does not exist|could not establish connection/i.test(error instanceof Error ? error.message : "")) throw error; }
  if (response == null) {
    const before = await chrome.tabs.get(run.tabId);
    if (!before.url || new URL(before.url).origin !== new URL(run.sourceUrl).origin) throw Error("Origin changed before receiver repair");
    await chrome.scripting.executeScript({ target: { tabId: run.tabId, frameIds: [0] }, files: ["content/directory3-receiver.js"] });
    const after = await chrome.tabs.get(run.tabId);
    if (!after.url || after.url !== before.url) throw Error("Page changed during receiver repair");
    response = await chrome.tabs.sendMessage(run.tabId, { type: "BA2_D3_INSPECT" }, { frameId: 0 });
  }
  if (!response || typeof response.ok !== "boolean") throw Error("Directory3 receiver did not acknowledge inspection");
  return response as { ok: boolean; reason?: string; review?: Directory3Review;
    observation?: { documentKey: string; textDigest: string; ready: boolean; formPresent: boolean };
    outcome?: { outcome: Directory3Outcome; candidate?: string; evidence: string[] } };
}
async function save(run: ListingRun, patch: Partial<ListingRun>, extra: Record<string, unknown> = {}): Promise<ListingRun> {
  const latest = await readListingRun();
  if (!latest || latest.id !== run.id || latest.directory3?.intentId !== run.directory3?.intentId) throw Error("Saved run changed; nothing overwritten");
  const updated = updateListingRun(latest, patch);
  await chrome.storage.local.set({ ...extra, [LISTING_RUN_KEY]: updated }); return updated;
}
// Compatibility refusals for old popup/worker messages. Never grant or dispatch
// an automatic submission; keep historical approvals and receipts untouched.
export async function prepareDirectory3(_runId: string, _automatic = false) { return failure("Review is not required. Complete the website's human steps and click Continue yourself."); }
export async function authorizeDirectory3(_runId: string, _digest: string, _acceptTerms: boolean, _authorize: boolean) { return failure("Directory3 Continue is human-only"); }
export async function claimDirectory3(_runId: string, _intentId: string, _sender: chrome.runtime.MessageSender) { return failure("Directory3 Continue is human-only"); }

export async function observeDirectory3ManualSubmit(runId: string, sender: chrome.runtime.MessageSender) {
  return directory3Locked(runId, async () => {
    const run = await boundRun(runId);
    if (!trustedContent(run, sender)) return failure("Wrong manual-submit source");
    const tab = await chrome.tabs.get(run.tabId);
    if (sender.url !== tab.url) return failure("Manual-submit page changed");
    const state = run.directory3;
    if (!state?.observation || state.verification) return failure("Observation not armed");
    if (state.observation.submittedAt) return { ok: true as const };
    const intentId = state.intentId || `human:${crypto.randomUUID()}`;
    const keys = [directory3ReceiptKey(state.review.identityKey), profileReceiptKey(run.profileId)];
    const receipts = await chrome.storage.local.get(keys);
    const receipt: Directory3Receipt = { runId, intentId, digest: state.review.digest, claimed: true, outcome: "uncertain" };
    const extra: Record<string, unknown> = {};
    if (!receipts[keys[0]]) extra[keys[0]] = receipt;
    if (!receipts[keys[1]]) extra[keys[1]] = { runId, intentId };
    // This records an already observed native human event; it never delays or
    // authorizes that event. Existing receipts are never overwritten.
    await save(run, { stage: "SUBMITTING", directory3: { ...state, phase: "attempted", intentId,
      observation: { ...state.observation, submittedAt: new Date().toISOString() } }, manual: ["Human Continue observed; waiting for the result. MAHID never submits or retries."] }, extra);
    return { ok: true as const };
  });
}
async function publicHtml(url: string): Promise<string> {
  const response = await fetch(url, { method: "GET", credentials: "omit", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/html") || !response.body) throw Error("Public HTML unavailable");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 1_000_000) { await reader.cancel(); throw Error("Public HTML exceeds bound"); } chunks.push(value); }
  const body = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(body);
}
export async function progressDirectory3(runId: string): Promise<void> {
  await directory3Locked(runId, async () => {
    let run = await boundRun(runId);
    if (run.directory3?.verification) return;
    const status = await inspect(run);
    if (!status.ok || !status.review || !status.observation) return;
    // Keep the prior document/text baseline until the response is readable.
    // Otherwise an early loading event consumes an opaque result's only change.
    // A parsed/validated native form can be filled while trailing resources
    // still hold readyState at loading. Arm its initial human-submit baseline
    // now; an existing/result baseline still waits for a readable document.
    if (!status.observation.ready && (run.directory3 || run.nativeDirectory?.phase !== "manual" || !status.observation.formPresent)) return;
    const state: Directory3Submission = run.directory3 || { phase: "observing", review: status.review, reviewedAt: Date.now() };
    const previous = state.observation;
    const snapshot = status.observation;
    const outcome = status.outcome?.outcome || "uncertain";
    const changedDocument = !!previous && previous.documentKey !== snapshot.documentKey;
    const changedResult = !!previous && previous.textDigest !== snapshot.textDigest;
    const finished = snapshot.ready && (!!previous?.resultAt || outcome !== "uncertain" || changedDocument
      || changedResult && (!!previous?.submittedAt || !snapshot.formPresent) || !previous && (!!state.intentId || !snapshot.formPresent));
    const observed = outcome === "uncertain" && !status.outcome?.evidence.length ? state.outcome || "uncertain" : outcome;
    const observation = { ...previous, documentKey: snapshot.documentKey, textDigest: snapshot.textDigest,
      ...(finished ? { resultAt: previous?.resultAt || new Date().toISOString(), resultUrl: (await chrome.tabs.get(run.tabId)).url, evidence: status.outcome?.evidence || [] } : {}) };
    const message = !finished ? "Complete the website's CAPTCHA/Terms yourself, then click Continue. MAHID will inspect the result automatically."
      : observed === "duplicate" ? "URL already exists. No resubmission; checking existing public listings read-only."
      : observed === "pending" ? "Submission awaits directory review. No retry or unverified URL."
      : observed === "validation-error" || observed === "rejected" ? "Website returned validation/rejection evidence. No automatic retry."
      : observed === "accepted" ? "Website acceptance observed; public listing URL still requires verification."
      : "Result page observed; submission outcome uncertain. Do not resubmit to resolve uncertainty.";
    run = await save(run, { stage: "MANUAL_GATE", status: finished && observed === "pending" ? "pending" : "needs-human",
      directory3: { ...state, observation, ...(finished ? { outcome: observed } : {}) }, manual: [message] });
    if (!previous) {
      try { await chrome.tabs.sendMessage(run.tabId, { type: "BA2_D3_WATCH" }, { frameId: 0 }); } catch { /* Read-only observation resumes at page startup/completion. */ }
    }
    if (!finished) return;
    let candidate = status.outcome?.candidate;
    const currentUrl = (await chrome.tabs.get(run.tabId)).url!;
    if (new URL(currentUrl).pathname === "/details.php") candidate = directory3PublicUrl(currentUrl, new URL(state.review.url).origin) || undefined;
    if (observed === "duplicate" && !observation.discoveryAttempted) {
      run = await save(run, { directory3: { ...run.directory3!, observation: { ...observation, discoveryAttempted: true } } });
      try {
        // GET action /index.php and q are verified native search form fields.
        const search = new URL("/index.php", state.review.url); search.searchParams.set("q", new URL(state.review.website).hostname);
        const html = await publicHtml(search.href);
        const found = await chrome.tabs.sendMessage(run.tabId, { type: "BA2_D3_DISCOVER_HTML", html, url: search.href, review: state.review }, { frameId: 0 }) as { candidates?: string[] };
        if (found.candidates?.length === 1) candidate = found.candidates[0];
      } catch { /* Existing listing not discovered; duplicate remains explicit. */ }
    }
    const safe = candidate && directory3PublicUrl(candidate, new URL(state.review.url).origin);
    if (!safe || run.directory3?.verificationAttempted || ["validation-error", "rejected"].includes(observed)) return;
    try {
      run = await save(run, { directory3: { ...run.directory3!, verificationAttempted: true } });
      const html = await publicHtml(safe);
      const proof = await chrome.tabs.sendMessage(run.tabId, { type: "BA2_D3_VERIFY_HTML", html, url: safe, review: state.review }, { frameId: 0 }) as { ok?: boolean };
      if (proof?.ok !== true) return;
      await save(run, { stage: "COMPLETE", status: "success", liveUrl: safe,
        directory3: { ...run.directory3!, outcome: observed === "duplicate" ? "duplicate" : "public-verified", publicUrl: safe,
          verification: { url: safe, checkedAt: new Date().toISOString(), status: "verified" },
          sheetPreparation: { status: "awaiting-original-sheet-validation", column: "B", domain: "directory3.org", url: safe } },
        manual: [observed === "duplicate" ? "Duplicate URL: existing public listing verified. No resubmission or Sheets write." : "Public listing verified. Column B draft awaits original-sheet validation; no Sheets write."] });
    } catch { /* Unknown identity/page never becomes a published URL. */ }
  });
}
