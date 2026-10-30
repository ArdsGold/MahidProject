import { manualAutofillFamily } from "../manual-autofill-policy";
import { isAutomationExcluded, AUTOMATION_EXCLUDED_MESSAGE } from "@backlink-autofill/shared";
import { getFamily3Adapter } from "../automation/adapters";
import type { ActiveProfileResponse, ExtensionMessage, ListingRunAck, SyncResponse } from '../messages';
import type { ListingRun } from '../listing-run';
import { BUILD_ID, TRACE_READ_ONLY } from '../publication-trace';
import { withTimeout } from '../capture-lifecycle';

const profileStatus = document.getElementById('profile-status')!;
const profileSynced = document.getElementById('profile-synced')!;
const currentSite = document.getElementById('current-site')!;
const flowStatus = document.getElementById('flow-status')!;
const result = document.getElementById('result')!;
const autofill = document.getElementById('autofill-button') as HTMLButtonElement;
const dashboard = document.getElementById('dashboard-button') as HTMLButtonElement;
const sync = document.getElementById('sync-button') as HTMLButtonElement;
let ready = !TRACE_READ_ONLY;
let sending = false;
const trace = document.getElementById('publication-trace')!;
void chrome.runtime.sendMessage({ type: 'BA2_GET_PUBLICATION_TRACE' } satisfies ExtensionMessage).then(response => {
  trace.textContent = JSON.stringify({ popupBuild: BUILD_ID, worker: response ?? 'No trace acknowledgement; loaded worker may be older.' }, null, 2);
}).catch(() => { trace.textContent = `Popup build ${BUILD_ID}; worker trace request rejected. No automation started.`; });

const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function renderRun(run: ListingRun | null): void {
  if (!run) { result.textContent = 'Ready. AUTOFILL continues from your current page.'; return; }
  const title = run.publicVerification?.status === 'verified' ? 'PUBLIC ARTICLE VERIFIED'
    : run.submissionAttempted ? 'CHECKING PUBLICATION OUTCOME'
    : run.login?.state === 'waiting-captcha' || run.registration?.state === 'waiting-human' ? 'WAITING FOR HUMAN CHECKPOINT'
    : ['ERROR', 'FAILED'].includes(run.stage) ? 'AUTOFILL BLOCKED'
    : ['MANUAL_GATE', 'HUMAN_GATE'].includes(run.stage) ? 'MANUAL REVIEW'
    : run.stage === 'COMPLETE' ? 'AUTOFILL COMPLETE' : 'AUTOFILLING';
  result.innerHTML = `<strong>${title}</strong>${(run.manual || []).map(item => `<p>${escape(item)}</p>`).join('')}${run.error ? `<p class="error">${escape(run.error)}</p>` : ''}${run.publicVerification?.status === 'verified' && run.liveUrl ? `<p>${escape(run.liveUrl)}</p>` : ''}`;
}
async function refresh(): Promise<void> {
  try {
    const profile = await withTimeout(chrome.runtime.sendMessage({ type: 'BA2_GET_ACTIVE_PROFILE' } satisfies ExtensionMessage), 5_000, undefined) as ActiveProfileResponse | undefined;
    // Display reads are not authorization. START checks the real current profile.
    ready = !TRACE_READ_ONLY;
    profileStatus.textContent = profile?.ok ? profile.profileName : 'No active profile';
    profileSynced.textContent = profile?.ok ? 'Using your existing MAHID profile.' : 'Open the dashboard and select an active profile.';
    dashboard.hidden = profile?.ok === true;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentSite.textContent = tab?.url && /^https?:/.test(tab.url) ? `Current Site: ${new URL(tab.url).hostname}` : 'Current Site: unavailable';
    let run: ListingRun | null = null;
    try {
      run = await withTimeout(chrome.runtime.sendMessage({ type: 'BA2_GET_LISTING_STATUS' } satisfies ExtensionMessage), 5_000, undefined) || null;
    } catch { /* History display cannot prevent current-page START. */ }
    const sameSite = !!run?.sourceUrl && !!tab?.url && new URL(run.sourceUrl).hostname.replace(/^www\./, "") === new URL(tab.url).hostname.replace(/^www\./, "");
    renderRun(sameSite && !manualAutofillFamily(tab?.url) ? run : null);
    if (manualAutofillFamily(tab?.url)) result.textContent = 'Ready. AUTOFILL fills this page only; navigation and submission are manual.';
    if (isAutomationExcluded(tab?.url)) { ready = false; result.textContent = AUTOMATION_EXCLUDED_MESSAGE; }
    flowStatus.textContent = 'Continue from Homepage, Sign Up, Login, Dashboard or Editor. Human checkpoints remain manual.';
    if (tab?.url && getFamily3Adapter(tab.url)) flowStatus.textContent = "Directory navigation and saved-profile autofill only. CAPTCHA and final Continue/Submit stay manual.";
    if (manualAutofillFamily(tab?.url)) flowStatus.textContent = 'Fill the current form only. Navigate, complete CAPTCHA/Terms and submit manually.';
    if (TRACE_READ_ONLY) flowStatus.textContent = 'Read-only trace build. Automation and navigation are disabled. Open Auto Visit trace below.';
  } catch {
    ready = !TRACE_READ_ONLY;
    flowStatus.textContent = 'Status unavailable. AUTOFILL will check the current page and profile. Nothing has been started.';
    dashboard.hidden = false;
  } finally { autofill.disabled = !ready || sending; }
}
async function start(): Promise<void> {
  if (!ready || sending) return;
  sending = true; autofill.disabled = true;
  try {
    const response = await withTimeout(chrome.runtime.sendMessage({ type: 'BA2_START_LISTING_AUTOFILL', continuous: true } satisfies ExtensionMessage), 15_000, undefined) as ListingRunAck | undefined;
    if (!response?.ok) {
      result.textContent = response?.error || 'No coordinator acknowledgement. Inspect the saved outcome; nothing will be retried automatically.';
      return;
    }
    if (response.message) result.textContent = response.message;
    else await refresh();
  } catch { result.textContent = 'AUTOFILL acknowledgement lost. No automatic retry; the saved outcome must be inspected.'; }
  finally { sending = false; autofill.disabled = !ready; }
}
autofill.addEventListener('click', () => { void start(); });
dashboard.addEventListener('click', () => {
  if (TRACE_READ_ONLY) return;
  void chrome.tabs.create({ url: 'http://localhost:3000' }).catch(() => { result.textContent = 'Could not open the dashboard.'; });
});
sync.addEventListener('click', () => {
  if (TRACE_READ_ONLY) return;
  void (async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(item => item.id !== undefined && item.url && /^https?:\/\/(localhost|127\.0\.0\.1):3000\//.test(item.url));
    if (!tab?.id) { result.textContent = 'Open the MAHID dashboard to refresh your profile.'; return; }
    const message = { type: 'BA2_SYNC_FROM_DASHBOARD' } satisfies ExtensionMessage;
    let response: SyncResponse | undefined;
    try { response = await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 }); }
    catch (error) { if (!String(error).includes('Receiving end does not exist')) throw error; }
    // Extension reloads invalidate the receiver in an already-open dashboard.
    if (!response) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content/content.js'] });
      response = await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
    }
    if (!response?.ok) { result.textContent = response?.error || 'Dashboard sync unavailable. Nothing started.'; return; }
    await refresh();
  })().catch(() => { result.textContent = 'Dashboard sync unavailable. Nothing started.'; });
});
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === 'local' && changes['ba2.listingRun']) void refresh();
});
autofill.disabled = TRACE_READ_ONLY;
if (TRACE_READ_ONLY) { dashboard.disabled = true; sync.disabled = true; }
void refresh();
