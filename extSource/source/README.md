# Backlink Autofill 2.0

Clean rebuild of Backlink Autofill: a Business Profile dashboard plus a Chrome Extension that
autofills business directory / listing forms from the active profile.

**Milestone 1 (current):** local-only vertical slice. No Supabase, no Vercel, no remote
infrastructure. Profiles live in browser `localStorage`; the extension reads the active profile
through a local transport and fills only high-confidence form fields.

## Repository layout

| Path | Purpose |
| --- | --- |
| `shared/` | Shared TypeScript models: `BusinessProfile`, transport contract (`@backlink-autofill/shared`) |
| `web/` | Next.js dashboard: create / edit / save profiles, select the active profile |
| `extension/` | Chrome Extension (Manifest V3): profile transport, field detection, field mapping, autofill execution |
| `test/` | Local HTML test forms for manual AUTOFILL testing |

## Dashboard workspace

Open **New Profile** or a saved profile to review all five sections on one page.
Desktop uses the full window with Saved Profiles on the right and one Save Profile
action. Long Description and saved social links scroll internally; smaller screens
stack the sections. Password visibility and social URL detection/add/remove remain available.
Logo/Brochure upload and preview controls are removed from the UI only. Existing
asset references and files remain saved and available to the extension.

Rendered regression check against a running local dashboard (disposable browser,
synthetic profiles only): `node --experimental-strip-types test/dashboard-layout.mjs http://localhost:3000`.
Screenshots and viewport measurements are saved under `docs/screenshots/`.

## Prerequisites

- Node.js 20.9+ (tested on Node 24)
- Chrome (or Chromium)

## Install

```bash
npm install
```

## Run locally

```bash
# 1. Start the dashboard (http://localhost:3000)
npm run dev:web

# 2. Build the Chrome Extension (outputs extension/dist)
npm run build:extension

# 3. Optional Phase 1 Playwright fallback worker (visible, dedicated browser profile)
npm run playwright:worker
```

The Playwright worker listens only on `127.0.0.1:3210`, uses `.playwright-profile`, loads
`extension/dist`, and never uses the personal Chrome profile. `npm run playwright:browser` is an
alias for the same visible worker/browser process. Requests require the local token
`ba2-playwright-local-token`; set `BA2_PLAYWRIGHT_TOKEN` on the worker only when the extension
client token is changed in `extension/src/playwright-client.ts` too.

### Development-only AmpBlogs human-assisted authentication

The worker also exposes a token-protected `/ampblogs/dev/auth/*` flow when `NODE_ENV` is not
`production`. It does not read Google Sheets. The flow first performs read-only observation, then
requires a human `accountStatus` decision (`existing` or `new`) before accepting credentials.
Credentials are accepted only in the explicit `/start` request, filled into unique supported
fields, and never returned, logged, or persisted by the worker. CAPTCHA, Terms,
confirmation, and final registration/login submission remain manual. Use `/resume` after the human
action; use `/reset` only after an observed outcome or ambiguity before beginning another run.

Do not put credentials in shell history, source files, logs, screenshots, or saved workflow state.
The development endpoints retain the worker's localhost binding and `x-ba2-playwright-token`
authentication and are disabled when `NODE_ENV=production`.

To run the isolated development worker without loading the production extension or profiles, set
all development values before starting the existing worker entry point:

```powershell
$env:BA2_PLAYWRIGHT_PORT = "3211"
$env:BA2_PLAYWRIGHT_TOKEN = "<random-local-development-token>"
$env:BA2_PLAYWRIGHT_PROFILE_DIR = "$PWD\playwright-worker\.dev-runtime\playwright-profile"
$env:BA2_AMP_BLOGS_PROFILE_DIR = "$PWD\playwright-worker\.dev-runtime\ampblogs-profile"
$env:BA2_PLAYWRIGHT_DIAGNOSTICS_DIR = "$PWD\playwright-worker\.dev-runtime\diagnostics"
$env:BA2_AMP_BLOGS_STATE_DIR = "$PWD\playwright-worker\.dev-runtime\state"
$env:BA2_PLAYWRIGHT_LOAD_EXTENSION = "false"
npm.cmd run playwright:worker
```

This development process remains localhost-only, uses a separate token and browser data, and does
not load `extension/dist`; never copy production cookies, credentials, or profile directories.

For the supervised registration preparation, run `playwright-worker/dev-auth-start.ps1` locally.
It prompts for the development token and disposable username/email/password, sends `accountStatus=new`,
and prints only sanitized run metadata. The password is hidden during input and is not written to a
file, command line, log, or response. The worker fills the supported signup fields and stops before
CAPTCHA, Terms, and final registration submission.

Validation / build commands:

```bash
npm run typecheck        # tsc --noEmit in shared, web, extension
npm run build            # production build of web + extension
```

## Milestone 1 walkthrough

1. Start the dashboard with `npm run dev:web` and open <http://localhost:3000>.
2. Click **New profile**, fill at least Business Name, Contact Name, Email, Phone, Website, and
   **Save profile**.
3. Click **Set active** on the profile. The active profile is mirrored to the extension transport
   (localStorage key `ba2.activeProfile`).
4. Build and load the Chrome Extension (steps below).
5. Open `test/test-form.html` (served over http, or file:// with file access enabled).
6. Click the extension icon, then **AUTOFILL this page**.
7. Expected: the five labelled fields are filled; CAPTCHA / terms / newsletter / search stay empty;
   the form is **not** submitted (the red "Form submitted" line appears only if you press
   **Post Listing** yourself).

## Portable Windows x64 package

To build a separate production dashboard and package it with the extension,
application source, and the current Node.js runtime, run from the repository root
in PowerShell on Windows x64:

```powershell
$env:MAHID_PORTABLE_BUILD = "1"
npm.cmd run build
Remove-Item Env:MAHID_PORTABLE_BUILD
node scripts/package-portable.mjs
```

The ZIP is created under `releases/`. Extract it on the other Windows x64 computer,
run `Start Dashboard.cmd`, and open `http://localhost:3000`. Load the package's
`extension` folder through Chrome's **Load unpacked**. Node.js is bundled; no install
or build is required to run the package. Read `READ ME FIRST.txt` inside the ZIP.
The optional Playwright worker requires separate setup from the included source.
Existing browser profiles, saved business profiles, cookies, credentials and research
evidence are not copied. The separate `.next-portable` build leaves `.next` intact.
Packaging uses [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).

## Load the unpacked Chrome Extension

1. Run `npm run build:extension`. Confirm `extension/dist/manifest.json` exists.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle, top right).
4. Click **Load unpacked**.
5. Select the `extension/dist` folder (not the `extension` folder).
6. The extension "Backlink Autofill 2.0" appears in the toolbar. Pin it for convenience.

To pick up code changes: re-run `npm run build:extension`, then press the reload (circular arrow)
button on the extension card in `chrome://extensions`.

### If you test a `file://` page

After loading the unpacked extension, open `chrome://extensions`, find Backlink Autofill 2.0,
click **Details**, and enable **Allow access to file URLs**. Alternatively serve the test folder
over http:

```bash
npx http-server test -p 8080
# then open http://localhost:8080/test-form.html
```

## How the extension gets the active profile (Milestone 1 transport)

1. The dashboard stores the active profile payload in page `localStorage` (`ba2.activeProfile`).
2. The extension content script, running on the dashboard origin, mirrors that payload into
   `chrome.storage.local` (it also re-syncs every 2 s and via the popup **Refresh from dashboard**
   button).
3. The popup / autofill engine read the profile only from `chrome.storage.local` through
   `extension/src/content/transport.ts`.

A future Supabase-backed sync writes the same `chrome.storage.local` contract, so the autofill
engine does not change.

## Safety guarantees

The autofill engine (`extension/src/content/autofill.ts`):

- never submits forms (`form.submit` / `requestSubmit` are never called)
- never clicks any element (no `.click()`)
- never fills checkboxes, radios, file, password, hidden, disabled, or read-only inputs
- never touches CAPTCHA, terms/agreement, newsletter, or search fields
- fills a field only when the label / name / id / placeholder / type / context match is
  unambiguous (score threshold + margin over the runner-up slot)
- fills each profile slot at most once per page

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev:web` | Start the Next.js dashboard in dev mode |
| `npm run build:web` | Production build of the dashboard |
| `npm run build:extension` | Bundle the extension into `extension/dist` |
| `npm run playwright:worker` | Start the localhost Playwright inspection bridge and visible dedicated browser |
| `npm run playwright:browser` | Alias for the visible Playwright worker/browser process |
| `npm run typecheck` | TypeScript validation across all workspaces |
| `npm run build` | Full build (all workspaces) |

## Verified listing URL write-back (default disabled)

### Family 1 and Family 2: manual navigation and AUTOFILL only

Use the existing active MAHID profile and the same **AUTOFILL** button in the popup or on the page.
Navigate to the desired form yourself, then click AUTOFILL. Repeat after refresh when needed.

- Family 1: manually open Registration, Login or New Post. AUTOFILL uses existing mappings.
  New Post keeps the separate Title, saved business image at the top and EXACT original Long
  Description underneath, including formatting, spacing and clickable keyword hyperlinks.
  An existing Image URL is reused; if only a saved logo Blob exists, the existing read-only dashboard
  asset receiver supplies its bytes for an embedded image. Keep that dashboard tab open for this case.
- Family 2: manually open Registration, Login, Update Profile or Listing. Only confidently mapped
  fields fill. Profile Update also selects the ACTIVE profile's saved Business Logo
  in an explicitly identified Your Logo input, using the existing dashboard asset
  receiver (keep the dashboard tab open). Your Photo stays separate. State then City
  selects wait for dependent options. Click Update Profile manually; other file
  uploads remain manual. Unknown fields remain untouched.
  Listing Category matches the ACTIVE profile's saved category against enabled live
  dropdown labels, preferring an exact match and then suitable semantic matches.
  Option values come from the current page. Missing, unrelated or ambiguous matches
  leave Category unchanged and show a reason in the existing result (hover the
  floating status for its full text). Other business fields still fill.
  Family 2 also selects Yes for the existing Include Profile With Listing radio
  group when its question and Yes control are unambiguous and enabled. Submission
  remains manual; unrelated radio groups are untouched.
- Complete CAPTCHA and Terms yourself. Manually click Register, Sign In, Save, Publish and Visit.
  Completing CAPTCHA or Terms does NOT authorize or trigger any automatic action.
- Homepage, Dashboard and publication-success pages do not navigate. A click without recognized
  fields gives a clear result. Success-page Visit stays manual.
- No new run, approval, claim, receipt or archive is created by Family 1/2 autofill. Historical runs
  and uncertain receipts stay unchanged and do not block current field preparation. Their automatic
  startup/page-change continuations are dormant. A click never authorizes registration/Login/Publish.
- Family 3 keeps its existing routing, navigation, autofill, submission guards and passive result
  observation. No directory adapter or Family 3 test was changed. Sheets writes remain disabled.

Coverage: Family 1 membership comes from the existing 50-site read-only audit; Family 2 from its
17-row roster plus the three recorded additional targets. Membership is not evidence of a new
website's field selectors. Existing conservative mappings are reused; inaccessible forms are not guessed.

Controlled tests (disposable Chrome; no live requests):
`node extension/test/native-manual-families-smoke.mjs`
`node extension/test/native-manual-assets-smoke.mjs`
`node extension/test/native-registration-login-smoke.mjs`
`node extension/test/native-family3-integration-smoke.mjs`
`npm.cmd run test:engine --workspace extension` retains historical coordinator regressions under an
explicit test-only define, and checks the production manual-family policy separately. Production
builds always define that historical test switch false. No user-facing mode or extra button exists.

### Historical publication recovery (dormant for manual Family 1/2)

Family 1/2 automatic recovery and Visit are disabled by the current manual policy. The following
legacy API reference is retained for history; it is not the normal workflow.

Normal authorized publication needs no second AUTOFILL, Check Publication or Recover click. The existing coordinator arms a 60-second read-only success observer before its single publication dispatch. A loaded success document also checks the saved intent automatically. Delayed AJAX success notifies the same coordinator with run/attempt IDs only; sender tab/frame/origin and persisted receipt/approval/evidence are rechecked. Tab completion and service-worker startup reuse the same recovery function. Automatic recovery is capped at two persisted attempts per run; missing/ambiguous evidence and exhausted limits stop safely. AUTOFILL uses the same receipt-bound observation recovery when an existing publication outcome needs inspection; no separate recovery button is required.

Keep the existing Onesmablog success tab open. Do not reload that website tab: it may be a POST response. Do not click AUTOFILL, Publish, Edit, or prepare a fresh run.

1. Before recovery, inspect the current saved run from popup DevTools Console without returning content or credentials:

   ```js
   (async () => {
     const r = (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun'];
     if (!r) return { status: 'BLOCKED', reason: 'No saved run' };
     const host = new URL(r.sourceUrl).hostname.toLowerCase().replace(/^www\./, '');
     const key = `ba2.publicationGuard:${host}:${r.profileId}`;
     const receipt = (await chrome.storage.local.get(key))[key];
     return { stage: r.stage, submissionAttempted: !!r.submissionAttempted,
       submissionOutcome: r.publicationSubmission?.outcome ?? null,
       claimed: r.publicationSubmission?.claimed ?? null,
       approvalPresent: !!r.publicationApproval, expectedArticlePresent: !!r.expectedArticle,
       receiptPresent: !!receipt, receiptOwnedByRun: receipt?.runId === r.id,
       verificationStatus: r.publicVerification?.status ?? null, liveUrlPresent: !!r.liveUrl };
   })()
   ```

2. Stop if saved intent/approval/expected article or the same-run receipt is missing. Do not reconstruct publication intent or clear receipts. Review the diagnostic before loading updated artifacts.
3. Reload only the extension from `extension/dist`, preserving its storage and the website success tab. Startup automatically checks the saved success page, including interrupted/unverified verification, without redispatching publication. Expect PUBLIC ARTICLE VERIFIED, GET navigation to the verified public URL, then read-only Sheets preparation; no recovery click is needed in normal operation. A restart after verification was saved also continues navigation/preparation, with interrupted preparation reads capped at two attempts.
4. If the automatic budget is exhausted or the saved tab is unavailable, stop and inspect the metadata. The internal `BA2_RECOVER_PUBLICATION` endpoint remains available for reviewed diagnostics, without a normal recovery button. It requires the same run's receipt/approval/expected content and only recognizes explicit success plus a unique safe Visit URL. Edit is rejected. Missing content listeners restore only `content/publication-reader.js`: observation and detached parsing, no autofill/login/submission code.
5. Expect PUBLIC ARTICLE VERIFIED and the public URL. The existing verifier performs anonymous GETs (no cookies/referrer/cache), bounded to four safe redirect/canonical hops, ten seconds of network time and 2 MB per response. Hidden/opaque redirects, auth/edit/draft/off-publisher URLs, ambiguous canonicals, unavailable/mismatched content stop safely. Complete expected body/links/image are checked for newly captured runs; older expectations are conservatively rebuilt only from the unchanged approved profile, with the stored heading/excerpt cross-checked first.
6. A verified URL is saved to the same ListingRun/receipt, together with separate website-confirmation and independent-verification evidence, before opening it via GET. It then reuses the existing authenticated backend in `?mode=prepare`: only an original-sheet A17:B GET/domain lookup, never a write, even if the write flag is enabled. `ListingRun.sheetSync` stores `mode: prepare`, ready/already-recorded/conflict/blocked and the exact B range when uniquely matched. Review that exact cell and URL before separate write approval. No batch queue/authorization entry point exists in the current code, so next-site batch continuation is blocked; publication approval alone never starts another website.

The existing extension coordinator can record an authorized, verified public article in the original pilot spreadsheet through the existing Next.js backend at `/api/google-sheets/write-back`. It reuses the spreadsheet ID and `Sheet1` from `playwright-worker/ampblogs/sheets.mjs`; it does not start the Playwright worker or any browser.

Writes remain disabled until the operator separately approves Google Sheets write access. The trusted server accepts an explicitly supplied Google OAuth access token. On this Windows development computer, when that token is absent, it can also reuse the installed Google Cloud SDK's bundled Python/google-auth library to refresh the existing local ADC credentials with only `https://www.googleapis.com/auth/spreadsheets`. No consent flow, credential store, or dependency is added to MAHID. The refreshed token is scope-checked and stays in a private server child-process pipe; it is never returned to the extension. Missing/rejected credentials stop safely. A read-only token cannot write; Google token-info scope inspection must confirm the Sheets write scope before any Sheets mutation. Existing active sessions are not restarted automatically.

For separately approved live writes, configure the Next.js server privately (never commit these values). The connection-only setup below deliberately leaves writes disabled:

- `BA2_SHEETS_WRITE_APPROVED=true` Ã¢â‚¬â€ explicit local activation; this does not grant Google permission.
- `BA2_GOOGLE_SHEETS_ACCESS_TOKEN` Ã¢â‚¬â€ optional explicit server token with the approved Sheets write scope and access to the original document; takes precedence over the local Windows SDK/ADC fallback. Keep this value on the server only.
- `BA2_SHEETS_EXTENSION_ID` Ã¢â‚¬â€ the installed MAHID extension ID.
- `BA2_SHEETS_WRITEBACK_KEY` Ã¢â‚¬â€ a distinct random local connection key of at least 32 characters, separate from all Google tokens.

Configure only that local connection key in the extension's trusted `chrome.storage.session` under `ba2.sheetsBackendKey`, through the extension's own DevTools context. Never place a Google OAuth token in extension storage, page scripts, diagnostics, or chat. Session storage is not exposed to content scripts by default; do not broaden its access level. This connection is local-only (`localhost:3000`), origin-bound to the configured extension and authenticated with the local key.

After verified publication, the extension saves the public URL, opens it through GET and automatically prepares the exact column B update through the same endpoint with `?mode=prepare`. That authenticated mode bypasses only the write-activation gate to read the original A17:B range; all business/publication/current-verification guards still apply and the existing writer returns before its mutation path. It cannot write regardless of the server write flag. A ready preparation is distinct from recorded/read-back-confirmed.

The existing explicit synchronization path refreshes anonymous article accessibility/identity and persists synchronization intent before contacting the write endpoint, which still requires separate activation. The backend matches the publisher's normalized domain against `A17:A`, rescans before mutation, rejects zero/multiple matches and conflicting/formula values in B, and uses one RAW single-cell B update. An identical existing URL produces no PUT. It reads the publisher/B cell back and rechecks domain uniqueness before reporting `recorded`/`already-recorded`.

`ListingRun.sheetSync` records authorization blockers, conflicts, confirmed results, and uncertain/interrupted outcomes without changing the publication result. The popup's **Record verified URL in Sheets** action retries only blocked synchronization after authorization is corrected; it cannot publish or retry an uncertain write. There is no automatic retry after lost delivery or restart.

Coordinate live acceptance with no concurrent sheet editing. The local backend serializes its own requests and checks row mapping before/after writing, but the Sheets values API does not atomically bind a domain lookup to a later cell update against external editors. A changed mapping/read-back is reported as uncertain, never silently repaired.

Run fixture-only checks with `npm.cmd run test:sheets` (the current test runtime uses Node's TypeScript stripping), plus extension tests/typecheck/build. No live authorization, token access, or Sheets write is part of these tests.

### Prepare the local connection without enabling writes (Windows)

OAuth/read success does not configure the separate extension/backend connection. The backend
requires `BA2_SHEETS_EXTENSION_ID` and `BA2_SHEETS_WRITEBACK_KEY` in its own process environment;
the extension requires that same key in trusted session storage. No private Sheets launcher is
required. Use the installed extension ID shown by `chrome://extensions` (the ID is not a secret):

```powershell
# Needed only if this local shell blocks unsigned workspace scripts; affects this process only.
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
& .\scripts\prepare-sheets-connection.ps1 -ExtensionId '<installed 32-character extension ID>'
```

The helper creates/reuses `.local-sheets/connection.json`, restricted by Windows ACL to the current
user and ignored by Git. It generates a 32-byte random local key only on first setup, refuses
mismatched existing configuration, never displays the key, and loads the existing server variables
into this PowerShell process. It forces `BA2_SHEETS_WRITE_APPROVED=false`; Google credentials are
untouched. Do not commit, upload, paste, or print the private file. The helper starts no services.
Re-run it in the same shell before the **next planned** `npm.cmd run dev:web` (or normal Next start).
It cannot change an already running server's environment. Leave active services running during
preparation; adopting the configuration requires an operator-controlled later launch. Review any
pre-existing `.env*` or launcher configuration locally rather than replacing a different key.

After backend adoption, open the extension popup, right-click inside it and choose **Inspect**.
Use the popup's DevTools Console, not a website console or the service-worker console. Run this
secret-free snippet, then use **Choose private connection file** in the popup to select
`.local-sheets/connection.json` (the picker may hide dot-directories). It imports only the separate
connection key into trusted session storage and probes the existing route with `{}`. It neither
changes `ba2.listingRun` nor invokes any publication/synchronization message.

```js
(() => {
  if (location.href !== chrome.runtime.getURL('popup/popup.html')) throw Error('Use popup DevTools.');
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.json';
  const label = document.createElement('label');
  label.textContent = 'Choose private connection file';
  label.append(picker);
  document.body.append(label);
  picker.oncancel = () => label.remove();
  picker.onchange = async () => {
    try {
      const file = picker.files?.[0];
      if (!file || file.size > 1024) throw Error();
      const config = JSON.parse(await file.text());
      if (Object.keys(config).sort().join(',') !== 'extensionId,key'
          || config.extensionId !== chrome.runtime.id || !/^[a-f0-9]{64}$/.test(config.key)) throw Error();
      const existing = (await chrome.storage.session.get('ba2.sheetsBackendKey'))['ba2.sheetsBackendKey'];
      if (existing && existing !== config.key) throw Error();
      await chrome.storage.session.set({ 'ba2.sheetsBackendKey': config.key });
      const response = await fetch('http://localhost:3000/api/google-sheets/write-back', {
        method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(15000),
        headers: { 'content-type': 'application/json', 'x-ba2-sheets-key': config.key },
        body: '{}'
      });
      const result = await response.json();
      const accepted = response.ok && result.code === 'write-approval-required';
      console.log(accepted ? 'PASS: connection authenticated; Sheets writes disabled; no Sheets access.'
        : response.ok && result.code === 'verification-required'
          ? 'FAIL: key accepted, but backend writes are enabled. Disable writes before continuing.'
          : 'FAIL: backend configuration not accepted.');
    } catch {
      console.log('FAIL: check trusted context, matching configuration, backend availability and CORS. No sync invoked.');
    } finally { label.remove(); }
  };
})();
```

Expected result with this setup: `write-approval-required`. Empty input also stops at
`verification-required` if a backend already has writes enabled; the snippet reports FAIL in that
case because this connection-only procedure requires writes disabled. Both codes occur before
OAuth resolution or Google requests. A `403` or CORS/network failure does not
confirm a working connection. The key may have been stored even when the probe fails; repeat the
same import after backend configuration adoption, without replacing the current run. Chrome
session storage must be repopulated after browser restart/extension reload. Keep session storage's
default trusted-context access level. Do not use **Record verified URL in Sheets** as a connection
test and do not resume/publish the current run for this check.

Setup/probe regression checks use isolated fixtures and never contact Google:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File test/sheets-connection.test.ps1
npm.cmd run test:sheets
```

### Safe live acceptance of manual AUTOFILL

Load the current build in Chrome while preserving open tabs and extension data. Manually open an
existing Family 1 Login or New Post form. Click AUTOFILL once; inspect the populated fields, then
refresh and repeat. Do not click Register, Sign In or Publish during this fill-only acceptance.
CAPTCHA/Terms completion must not submit or navigate. Existing success-page Visit is manual.
Family 3 retains its existing separate acceptance procedure. Keep Sheets writes disabled.

### Read-only recovery of a dashboard logo receiver checkpoint

`Could not establish connection. Receiving end does not exist.` means the dashboard message had
no reachable receiver; it is not evidence that the saved logo Blob is missing or has the wrong
owner. The asset sender now repairs that exact error once by injecting only the idempotent
`content/dashboard-assets.js` reader into frame 0 of the same allowed dashboard origin, then
retries the read once. It never injects the full autofill/profile-sync script, reloads a tab, or
rewrites assets. Ownership failures, other transport failures, timeouts and navigation remain
blocked. Logo/brochure bytes use JSON-safe integer arrays over Chrome messaging and become
validated binary buffers only before the existing file attachment operation.

Do not click AUTOFILL to diagnose the stopped article run. If `publicationEditorUrl` is already
saved, normal continuation enters publication validation immediately, reuses the saved approval,
and does not repeat logo retrieval. A valid editor can publish on that click. Duplicate receipts
and persisted attempts still prevent repeat submission, but this is not fresh authorization.

Safe operator procedure (no publication):

1. Return only the requested read-only ListingRun diagnostic, including `submissionAttempted`,
   publication intent/outcome, expected article, saved editor, approval presence and publication
   receipt presence. Do not reset the record, clear guards, or print the whole profile/storage.
2. Load/reload the built extension only when ready, keeping the saved run and original dashboard
   tab. Do not refresh the article editor or submit anything. An unsubmitted MANUAL_GATE normally
   remains paused on worker recovery; an unresolved login/attempt requires separate inspection.
   Reimport the existing private backend session key if needed and keep Sheets writes disabled.
3. For the asset check only, run the following in trusted MAHID **popup DevTools**. Set the
   nonsecret `dashboardOrigin` to the origin where the profile's asset was originally saved;
   localhost and 127.0.0.1 have separate IndexedDB storage. This does not open/reload a page,
   mirror a profile, autofill, resume a run, or publish. Only status/size/error is returned.

```js
await (async () => {
  if (location.href !== chrome.runtime.getURL('popup/popup.html')) throw Error('Use popup DevTools.');
  const dashboardOrigin = 'http://localhost:3000';
  if (!['http://localhost:3000', 'http://127.0.0.1:3000'].includes(dashboardOrigin)) return { ok: false };
  const profile = (await chrome.storage.local.get('ba2.activeProfile'))['ba2.activeProfile']?.profile;
  if (!profile?.logoAsset) return { ok: false, error: 'Active Profile has no logo reference.' };
  const tabs = await chrome.tabs.query({ url: dashboardOrigin + '/*' });
  const tab = tabs.find(tab => tab.id && tab.url && new URL(tab.url).origin === dashboardOrigin);
  if (!tab) return { ok: false, error: 'Open the original dashboard origin; do not recreate the asset.' };
  await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content/dashboard-assets.js'] });
  const current = await chrome.tabs.get(tab.id);
  if (!current.url || new URL(current.url).origin !== dashboardOrigin) return { ok: false, error: 'Dashboard navigated; stopped.' };
  const result = await chrome.tabs.sendMessage(tab.id, { type: 'BA2_GET_PROFILE_LOGO', profileId: profile.id,
    assetId: profile.logoAsset.id, fileName: profile.logoAsset.fileName }, { frameId: 0 });
  return result?.ok ? { ok: true, bytes: result.size } : { ok: false, error: result?.error || 'No receiver response.' };
})()
```

4. Stop after the read-only result. A successful read confirms asset delivery, not publication
   readiness. The existing saved run cannot resume with *fresh* consent: normal resume retains its
   old approval. If fresh authorization is required, review and separately approve the fresh
   homepage procedure above, which archives the old record unchanged. If any publication attempt,
   outcome or receipt exists, inspect existing posts/public URL instead of starting another run.

### Historical Login recovery APIs

The previous explicit existing-account and registration recovery endpoints remain available internally
with their original receipt/ownership/consent validation; the ordinary popup no longer renders their
preparation controls. Normal AUTOFILL uses verified current-page entry, preserves old runs and uses a
new scoped Login receipt when authenticated historical evidence is valid. Uncertain historical
Login/registration/publication attempts remain blocked or observed through the owning saved run.
Do not call internal recovery endpoints to bypass a receipt or archive conflict.


### Combined Family 1 and Family 3 extension (2026-10-20)

The existing **AUTOFILL** button selects the current website. Family 1/2 now fill only the current form with manual navigation/submission; the28 native Family 3 configurations navigate and fill saved business values/category, then stop before manual CAPTCHA and Continue/Submit. Directory3 results are observed automatically after the human action. Historical runs/receipts and saved profiles are retained. CargoDirectory is excluded and production extension Sheets writes are disabled.

See [integrated directory coverage, safeguards and validation](docs/family3/integration/README.md), including conditional Related Directory/Ifidir support and the safe Groovy acceptance test. Build with npm run build:extension; check npm run typecheck and npm run test:extension. Optional native proof: node extension/test/native-family3-integration-smoke.mjs (disposable/intercepted Chrome only).
