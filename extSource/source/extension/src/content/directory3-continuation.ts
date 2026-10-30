import { getActiveProfile } from "./transport";
import { validateDirectory3Submission } from "./listing-autofill";
import { readListingRun } from "../listing-run";
import { inspectDirectory3, isDirectory3Host } from "../automation/directory3";
import { classifyDirectory3Response, directory3Digest, directory3ProfileDigest, directory3Text, directory3ResultText, discoverDirectory3Links, verifyDirectory3PublicHtml, type Directory3Review } from "../automation/directory3-submission";

export async function inspectDirectory3Continuation() {
  const run = await readListingRun();
  if (!run || run.domain !== "directory3.org" || !isDirectory3Host(location.href) || new URL(run.sourceUrl).origin !== location.origin) return { ok: false as const, reason: "Directory3 run/origin mismatch" };
  const outcome = classifyDirectory3Response(document, location.origin);
  const observation = { documentKey: `${location.href}|${performance.timeOrigin}`, textDigest: await directory3Digest(directory3ResultText(document)), ready: document.readyState !== "loading", formPresent: inspectDirectory3(document, location.href).state === "form" };
  // Result observation is independent of form validity, CAPTCHA, consent, or a
  // later profile selection. Saved identity is used only for public verification.
  if (run.directory3) return { ok: true as const, review: run.directory3.review, outcome, observation };
  const profile = await getActiveProfile();
  if (!profile || profile.id !== run.profileId) return { ok: false as const, reason: "Directory3 profile mismatch" };
  const native = validateDirectory3Submission(profile);
  const plain = document.createElement("template"); plain.innerHTML = profile.description;
  const description = native.ok ? native.description : plain.content.textContent || "";
  const profileDigest = await directory3ProfileDigest(profile);
  let website = profile.website.trim();
  try { website = new URL(website).href.replace(/\/$/, ""); } catch { /* Observe invalid results too; public verification will refuse invalid identity. */ }
  const review: Directory3Review = { digest: profileDigest, profileDigest, identityKey: await directory3Digest([directory3Text(profile.businessName), website]), url: location.href,
    termsUrl: new URL("/rules.php", location.origin).href, termsNotice: "Human reviews the website's Terms and clicks Continue", name: profile.businessName, website: profile.website, description };
  return { ok: true as const, review, outcome, observation };
}

let observer: MutationObserver | undefined;
let scheduled: ReturnType<typeof setTimeout> | undefined;
let removeListeners: (() => void) | undefined;
export function stopDirectory3Watch(): void {
  observer?.disconnect(); observer = undefined;
  if (scheduled) clearTimeout(scheduled); scheduled = undefined;
  removeListeners?.(); removeListeners = undefined;
}
export function watchDirectory3Continuation(): void {
  stopDirectory3Watch();
  let busy = false, pending = false, last = "", observedRunId = "";
  const tick = async () => {
    if (busy) { pending = true; return; }
    busy = true;
    try {
      const run = await readListingRun();
      if (!run || run.domain !== "directory3.org" || !isDirectory3Host(location.href) || run.directory3?.verification) { stopDirectory3Watch(); return; }
      observedRunId = run.id;
      const signal = JSON.stringify([run.id, location.href, document.readyState, directory3ResultText(document)]);
      if (signal !== last) {
        const response = await chrome.runtime.sendMessage({ type: "BA2_D3_CHANGED", runId: run.id }) as { ok?: boolean };
        if (response?.ok) last = signal;
      }
    } catch { /* Observation failure never triggers submission, refill, or retry. */ }
    finally { busy = false; if (pending) { pending = false; schedule(); } }
  };
  const schedule = () => { if (scheduled) clearTimeout(scheduled); scheduled = setTimeout(() => { scheduled = undefined; void tick(); }, 100); };
  observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  const submit = (event: Event) => {
    if (!event.isTrusted) return;
    const native = inspectDirectory3(document, location.href);
    if (native.state !== "form" || event.target !== native.form) return;
    // Observe the native human submit event. Do not cancel, delay, validate,
    // accept Terms, touch CAPTCHA/reciprocals, or invoke any form action.
    if (observedRunId) void chrome.runtime.sendMessage({ type: "BA2_D3_MANUAL_SUBMIT", runId: observedRunId }).catch(() => undefined);
  };
  document.addEventListener("submit", submit, true);
  window.addEventListener("pageshow", schedule);
  removeListeners = () => { document.removeEventListener("submit", submit, true); window.removeEventListener("pageshow", schedule); };
  void tick();
}

// Reject queued messages from older workers. No extension code clicks Continue.
export async function submitDirectory3Once(_runId: string, _intentId: string) { return { ok: false, reason: "Directory3 Continue is human-only" }; }

function inertDirectory3Html(html: string): Document {
  const template = document.createElement("template"); template.innerHTML = html;
  template.content.querySelectorAll("script,iframe,object,embed,style,video,audio,source").forEach(el => el.remove());
  for (const element of template.content.querySelectorAll("*")) for (const attribute of [...element.attributes]) {
    if (/^on|^(?:src|srcset)$/i.test(attribute.name)) element.removeAttribute(attribute.name);
  }
  const inert = document.implementation.createHTMLDocument("");
  inert.body.replaceChildren(template.content.cloneNode(true));
  return inert;
}
export function verifyDirectory3Html(html: string, url: string, review: Directory3Review): boolean { return verifyDirectory3PublicHtml(inertDirectory3Html(html), url, review); }
export function discoverDirectory3Html(html: string, url: string, review: Directory3Review): string[] { return discoverDirectory3Links(inertDirectory3Html(html), url, review); }

export function installDirectory3Continuation(): void {
  if (window.top !== window || !isDirectory3Host(location.href)) return;
  void readListingRun().then(run => {
    if (run?.domain === "directory3.org" && (run.directory3 || run.stage === "MANUAL_GATE")) watchDirectory3Continuation();
  }).catch(() => undefined);
}
export function installDirectory3Receiver(): void {
  if (window.top !== window || !isDirectory3Host(location.href)) return;
  const owner = window as unknown as { __mahidDirectory3Receiver?: { event: typeof chrome.runtime.onMessage } };
  if (owner.__mahidDirectory3Receiver?.event === chrome.runtime.onMessage) return;
  owner.__mahidDirectory3Receiver = { event: chrome.runtime.onMessage };
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return undefined;
    if (message.type === "BA2_D3_INSPECT") { void inspectDirectory3Continuation().then(sendResponse).catch(() => sendResponse({ ok: false, reason: "Directory3 inspection failed" })); return true; }
    if (message.type === "BA2_D3_WATCH") { watchDirectory3Continuation(); sendResponse({ ok: true }); return true; }
    if (message.type === "BA2_D3_SUBMIT") { sendResponse({ ok: false, reason: "Directory3 Continue is human-only" }); return true; }
    if (message.type === "BA2_D3_VERIFY_HTML") { sendResponse({ ok: verifyDirectory3Html(message.html, message.url, message.review) }); return true; }
    if (message.type === "BA2_D3_DISCOVER_HTML") { sendResponse({ candidates: discoverDirectory3Html(message.html, message.url, message.review) }); return true; }
    return undefined;
  });
  installDirectory3Continuation();
}
