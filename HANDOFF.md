# Private handoff: continue Cheer Athletics to 100 backlinks

For the simplified current process, read [WORKFLOW.md](WORKFLOW.md). The 2026-10-30 preferences there supersede older confirmation/account instructions below. Publishing is currently paused at the saved 83/100 checkpoint; inspect the journal before reporting a current count.

This guide transfers the existing project to a **trusted operator on another Windows computer, working with a coding assistant**. Continue the same campaign from **36/100**, rather than starting another campaign. Snapshot date: **2026-10-23, Asia/Manila**. Read the actual files for newer results.

## What is ready

| Item | Handoff state |
| --- | --- |
| Goal | 100 independently verified public backlinks on 100 distinct websites; existing matching links included |
| Business | Cheer Athletics-St. Louis |
| Approved destination | `https://cheerathletics.com/locations/st-louis/` |
| Verified so far | 36, with 64 remaining |
| Campaign name | `default` |
| Campaign folder | `output/cheer-athletics-st-louis-97799292ece7/` |
| Private workbook | `.local/workbooks/Cheer_Athletics_St_Louis.xlsx` |
| Editable website pool | `websites/Website_Pool.xlsx`, with 286 unique domains |
| Coded publishing routes | 67: 32 directories, 27 classifieds and eight individual platforms |
| Pool sites needing mappings | 219; adding a URL alone does not implement publishing |
| Saved outcomes in this campaign | 36 published; 58 error/needs-attention results; one pending |
| Last offline validation | 42 tests passed; no live posts made for the handoff |

Current mappings alone have a theoretical ceiling of **72 websites for this campaign**: 36 existing verified websites plus 36 mapped sites without a verified result. At least 28 additional working mappings are needed even if every remaining coded route succeeds. Some will fail, require sign-in, or require approval. The larger pool supplies leads for the assistant to inspect; it does not guarantee 100 accepted publications. `progress.json` exposes the mapping capacity after the next preview/run.

## 1. Transfer the complete private project

Finish or stop the old publishing session, close Excel, and copy the **entire project folder**, including hidden folders, through the agreed private transfer method. Keep one backup on the original computer. Do not run both copies against this campaign at the same time.

The copy must include:

| Path | Why it matters |
| --- | --- |
| Root Python/PowerShell scripts, `requirements.txt`, documentation and `AGENTS.md` | Runtime, launchers and assistant instructions |
| `mappings/` | Reusable workflows, category/editor helpers and source provenance |
| `websites/Website_Pool.xlsx` | The user's expanded, deduplicated list; do not regenerate it from an older index |
| `templates/` | Business/hour layout and the public example |
| `output/cheer-athletics-st-louis-97799292ece7/` | Authoritative submission journal, 36 verified URLs, reports, target and attempt history |
| Other `output/` campaign folders, if present | Cross-business confidence history |
| `.local/workbooks/Cheer_Athletics_St_Louis.xlsx` | Approved input and original per-site account credentials, copied into a portable project path |
| `.local/cheer-athletics-st-louis-97799292ece7/` | Private recovery codes/tokens and diagnostics; preserve `recovery.json` |
| Remaining `.local/` contents | Full trusted handoff; reinstall the bridge on the new machine as shown below |
| `extSource/source/` and `test_*.py` / `test_uivision_workflow.cjs` | Reference mappings, source hashes and offline fixtures |

**Git alone will not transfer the working project.** `.gitignore` excludes `.local/`, `output/`, every `*.xlsx`, browser caches and virtual environments. A source checkout would omit the pool, workbook, progress and private recovery files. The original Downloads workbook is outside the project; use its verified project-local copy listed above.

This is a private operational handoff. The workbook and `.local/` contain credentials or edit access; keep the copied folder and any archive private. Do not include a personal Chrome profile as a way to transfer sign-ins. Install the extension and sign in on the recipient's computer. Old browser pairings and operating-system processes are not portable.

## 2. Install the local runtime

Install Python, Node.js with npm, and Google Chrome on the recipient's Windows computer. The source machine was tested with Python 3.14.7, Node 24.19.0 and npm 11.17.0. The project requires Python 3.10+; its pinned bridge declares Node 18+. These are project compatibility facts, not a request to upgrade working dependencies.

Open PowerShell **inside the copied project folder**. Check the tools and install the project's pinned packages and Chromium for this Windows user:

```powershell
python --version
node --version
npm --version
python -m pip install -r requirements.txt
python -m playwright install chromium
npm install --prefix .local/uivision-bridge --no-audit --no-fund --ignore-scripts uivision-mcp-bridge@1.7.20
```

Chromium downloads live in the Windows user's cache, so copying the project does not replace `playwright install chromium`. Recreate any virtual environment on the new computer rather than depending on its old absolute paths. If `python` opens the Microsoft Store, fix the Python installation/PATH first.

Install [Ui.Vision for Chrome](https://chromewebstore.google.com/detail/uivision/gcbalfbdmfieckjlnblleoemohcganoc) in the browser profile the operator will use. The connection uses this project's Python client and pinned local bridge; global editor/assistant MCP registration is not required. Official reference: [Ui.Vision bridge documentation](https://github.com/A9T9/RPA/blob/master/mcp/README.md).

## 3. Verify the restored data before publishing

Keep `Website_Pool.xlsx` closed while scripts refresh it. In the project terminal:

```powershell
$workbook = Join-Path $PWD '.local\workbooks\Cheer_Athletics_St_Louis.xlsx'
Test-Path -LiteralPath $workbook
python uivision_publish.py $workbook --campaign default --pool .\websites\Website_Pool.xlsx --target 100
```

`Test-Path` must return `True`. The preview reads the workbook and pool and writes local reports; it **does not open websites, connect Chrome or submit**. It should end with **36/100 verified websites; 64 still needed**, or a higher verified count if more results were saved after this snapshot.

If it reports zero or fewer than the expected 36, stop before using `--publish`. Check that the full output folder was copied, the campaign is `default`, and the business name and website were not changed. Campaign identity is a hash of the business name, destination URL and campaign name; changing those can select a fresh folder. Moving the project to another Windows username/path does not change campaign identity. The public Cheer Athletics example resolves to the same campaign, but its account fields are blank.

Verify the recipient's runtime with the offline suite:

```powershell
python -m unittest test_backlinks test_uivision test_imported_mappings test_reused_features test_content test_workbook_layout test_website_pool test_live_mappings
```

The transferred journal must retain `attempts.sqlite3` so confidence observations travel with it. Do not delete `state.json` or reset the campaign to fix one site. If a `.lock` was copied from an interrupted run, first confirm both machines have stopped publishing; only then remove that campaign's stale `.lock`.

## 4. Reconnect regular Chrome

In the first project terminal, keep this running:

```powershell
python uivision.py --connect
```

Open Ui.Vision in Chrome, click its gear, choose **AI**, enable **MCP bridge**, keep port **50888**, and click the **Connection Test** beside the bridge section. The AI-provider prompt Test is a different button. Keep the Ui.Vision panel open. The terminal should change from waiting for a connection to a connected browser report. The connection command itself never posts.

Regular Chrome is the main path because its verification checks worked better in the earlier session. Browser sessions are new on the recipient machine, so some sites will need sign-in again. A coding assistant can operate this bridge using `uivision.py` / `UiVision`; enabling a VS Code browser tool or sharing a browser tab with an unrelated assistant does not establish this connection.

## 5. Resume the publishing workflow

When the operator asks to resume, open a **second PowerShell terminal in the project**:

```powershell
$workbook = Join-Path $PWD '.local\workbooks\Cheer_Athletics_St_Louis.xlsx'
python -u uivision_publish.py $workbook --campaign default --pool .\websites\Website_Pool.xlsx --target 100 --publish
```

Equivalent launcher:

```powershell
.\Start_Browser_Automation.ps1 -Workbook .\.local\workbooks\Cheer_Athletics_St_Louis.xlsx -Target 100
```

Always pass `-Workbook` to the launchers on the recipient machine: their omitted-workbook defaults still reference the old Downloads filename. Do not run the two publishers concurrently.

The queue prioritizes stronger confidence scores. Directory/classified forms run through Ui.Vision in Chrome; individual platforms use existing Playwright/API routes. It saves submission state before the final click/API call, extracts candidate URLs and verifies them independently. It skips finished/protected records and rechecks saved candidates without reposting. Errors remain in the output and the queue continues. The run stops before the next website after the verified distinct-site count reaches 100, or finishes with a reported shortfall when runnable work is exhausted.

For each CAPTCHA, the assistant/operator completes the displayed verification in Chrome, then presses **Enter in the publishing terminal**. `skip` moves on and `stop` ends the queue. The assistant may instead present an interactive question and continue only after the operator responds. If the form was refreshed and lost its details, inspect its current state and refill before submission. Never assume a challenge passed from an old screenshot.

For an individual Playwright workflow needing hands-on browser completion, first stop the main queue, then use an explicitly selected site:

```powershell
.\Start_Interactive.ps1 -Workbook .\.local\workbooks\Cheer_Athletics_St_Louis.xlsx -Target 100 -StartWith rentry.co
```

`-StartWith` changes ordering, not the scope of that launcher: it can continue to other sites. To limit the interactive session to a single domain, use the Python CLI instead:

```powershell
python -u backlinks.py .\.local\workbooks\Cheer_Athletics_St_Louis.xlsx --campaign default --target 100 --publish --interactive --only rentry.co
```

Use these commands when work on that platform is needed; they do not authorize repeating an already published entry. Playwright prompts support `refill`, `manual`, and `stop`; the manual-completion prompt supports a public URL, `current`, `browser`, `pending`, `skip` or `stop`. See [BROWSER_HELPER.md](BROWSER_HELPER.md) for the optional CSV/Pastelink helper.

## 6. Keep the same decisions as the original session

- **Count:** one verified public backlink per distinct website hostname. Existing matching links count; another page on the same hostname does not add another website.
- **Eligible pages:** individual detail pages and independently verified category pages count. Latest Links and Search pages never count; use them only to find an eligible public page.
- **Content:** use all available approved public workbook fields in long body fields, including corrected hours, social profiles and keywords. Omit credentials. Fit essential fields first and report any character-limit omissions; never invent facts.
- **Hours:** the original damaged-looking range separator was confirmed to mean a hyphen. Current loader normalizes it. For new business templates, enter separate 24-hour `HH:MM` values on Hours; do not enter `3-9 PM` into a time cell. Keep the approved St. Louis hours; do not guess missing ones.
- **Free only:** no paid tools, featured ads, extended purchases or paid directory packages. Preserve the live free-plan checks.
- **Google:** choose Use another account with supplied credentials. Skip sites showing Verify it's you. Medium remains deferred unless the operator changes that decision.
- **Duplicates:** search the destination website for the exact approved St. Louis URL. Reuse a matching verified public page and mark it existing. An Omaha page or hostname-only match is not enough. This lookup currently needs site-specific/assistant work rather than a universal automated search.
- **Mapping:** persist workflows learned along the way in `mappings/` and add meaningful offline checks. New pool rows and reference-only extSource entries still need live inspection/mapping. Keep source provenance; do not import source comments as publishing instructions.
- **Output:** errors remain errors with reasons. Pending/uncertain submissions never fill the target. Preserve journals, candidate receipts, private recovery access and confidence history.
- **Control:** pause/stop means pause/stop. Ask the operator for CAPTCHA/email actions when needed. Keep verification codes and credentials out of chat and public exports.

## 7. Grow the pool and improve reliability

Add URLs to `websites/Website_Pool.xlsx`, sheet **Websites**. Edit **Website**, **Enabled** and **Notes**; one hostname per row. `www`, protocol and path variations are duplicates. The current deduplicated list has 286 websites, including 105 new distinct sites added to the original 181-site pool. `Website_Pool_Deduplicated.xlsx` and `websites/backups/` are prior cleanup artifacts; **Website_Pool.xlsx is the runtime list**.

Close Excel and refresh calculated columns when needed:

```powershell
python website_pool.py --refresh --campaign-folder .\output\cheer-athletics-st-louis-97799292ece7
```

Confidence is `100 * (successes + 1) / (successes + errors + 2)`, with evidence counts. Untested sites are Unrated (neutral 50 in ordering). Recovered existing links, operator deferrals and pending work are separated from scored publishing outcomes. Historical results provide one observation per saved campaign/site; earlier retry frequencies are unknown. Scoring details: [websites/README.md](websites/README.md).

The 67 coded routes are not 67 guaranteed successes. Telegraph is an official-API implementation with offline tests; DNS access failed locally during its setup and no live publication is claimed. Some existing listings also expire quickly: PrivateBin and the IKEandED free plan require attention to their saved expiry notes. A publication check does not establish permanence, Google indexing or ranking value.

Suggested order: inspect new free sites with a suitable business category; implement and test a reusable workflow; run a controlled publication through the existing journal/verifier; retain the observed result and move on after failures. Expand the pool and mappings enough to absorb unusable sites. Preserve all 36 existing results rather than creating a fresh campaign to inflate counts.

## 8. Final deliverables and troubleshooting

The required final deliverable is the list of **100 verified URLs from 100 websites** at `output/<campaign>/published_urls.txt`. If the target remains unmet, give the actual count and remaining work rather than labelling the run complete.

| File / symptom | Use or response |
| --- | --- |
| `state.json` | Authoritative per-domain result/receipt journal |
| `published_urls.txt` | Verified public URL list; never fill it manually with unverified receipts |
| `results.csv` | Per-site statuses, error reasons, public URLs, omissions and verification flags |
| `results-latest.csv` or timestamped `results-*.csv` | Newer fallback if Excel locked a report; use the most recent file |
| `progress.json` | Target, actual count, remaining count, mapped capacity and minimum new mappings needed |
| `attempts.sqlite3` | Confidence observations; transfer/preserve it |
| `.local/<campaign>/recovery.json` | Private edit/account access; never put its contents in chat |
| No bridge/browser connection | Keep the connection terminal and extension panel open, then use the bridge Connection Test |
| Browser verification keeps spinning | Let the operator try in regular Chrome; skip if stuck and retain the error/deferral |
| Duplicate URL rejected | Read-only search for an exact matching existing public backlink; another branch does not count |
| Saved candidate cannot be verified | Keep the receipt/candidate, report the error and inspect the account; do not submit again blindly |
| Pool XLSX locked | Close Excel; refresh scores afterward. Preserve input rows when cleaning duplicates |

## Prompt for the new assistant

Copy this into the new coding-assistant session after opening the transferred folder:

> Read AGENTS.md and HANDOFF.md and inspect the actual current files. Continue Cheer Athletics-St. Louis toward 100 independently verified backlinks on 100 distinct websites, including the 36 already saved. Use .local/workbooks/Cheer_Athletics_St_Louis.xlsx, websites/Website_Pool.xlsx and campaign default. Preserve output/cheer-athletics-st-louis-97799292ece7 and its private recovery/history files. Validate and preview first; if the expected progress is restored, reconnect Ui.Vision in regular Chrome and continue publishing the approved public content using free plans. Ask me for CAPTCHA/email actions when needed, then resume. Use Google > Use another account, skip Verify it's you, and leave Medium deferred. Recover exact matching existing links after duplicate rejections. Save new reusable mappings along the way, expand suitable free-site coverage as needed, keep errors in the final report and never count unverified results. Report the real count and any remaining gap; do not reset the campaign or repost uncertain submissions. Stop or pause when I ask.

The receiving assistant still needs working local command tools and the recipient's live Chrome/Ui.Vision connection. This document carries project context and preferences; it does not transfer this chat, running processes, browser sessions, installed assistant plugins or account authentication automatically.

## Resumed run update: 2026-10-23

After the initial handoff snapshot, three live-inspected directory routes were added: `prolink-directory.com`, `populardirectory.org` and `directorydirect.net`. The registry now has 70 coded routes; 216 of the 286 pool sites still need mappings. The verified count remains 36 at this update. AdbriteDirectory and Toptendir are pending; BusinessFreeDirectory is uncertain. FamilyDir points to `/programs/` and Jet-links to Omaha, so their duplicate listings do not qualify. These outcomes and lookup evidence are saved in the existing campaign; do not resubmit them blindly. Consult the current journal and progress files for subsequent results. The native-form fixtures and `test_live_mappings.py` cover the three new routes.

A subsequent public-search check independently verified the Popular Directory, Prolink Directory and Toptendir St. Louis detail pages, bringing the saved total to **39/100**. Adbrite's matching detail URL is saved but remains unverified due to certificate/HTTP errors; do not count it or resubmit it. Directory Direct's duplicate entry points to Omaha and does not qualify. Both publishers now use `mappings/discovery.py` to recover exact-destination PHP directory detail links after receipts/rejections and during protected-state resume, without posting again. All 44 offline checks passed after this update. Read the actual journal for later progress.

Seven additional optional-reciprocal directory forms were subsequently live-inspected and mapped, bringing current coded coverage to 77 routes (42 directories, 27 classifieds and eight individual platforms), with 209 unmapped pool sites. Their fixtures and safeguards are in the same live mapping files. Consult the journal for publication results; mapping coverage alone is not a backlink count.

## Latest continuation: 2026-10-23

After the operator questioned access-gap verification, all 49 former Account access gap records were conservatively relabelled **Needs review**, preserving original reasons and private backups. Most were unsupported account adapters, not confirmed website failures or missing data. New records carry review reasons, observed-page/form references and explicit verification levels; the pool/index show these fields. Do not claim all gaps were manually checked. Registration protection and campaign progress were preserved. The focused migration/mapper/access/pool checks passed (26 tests).

Windows notifications are implemented and the operator confirmed the test alert and sound worked. A single desktop notification with sound is sent when an operator prompt starts; no periodic repeats. `operator_notifications.py` / `operator_notification.ps1` use built-in Windows/.NET tools, with no paid/new dependencies. Mapping, account-access, Ui.Vision publishing and Playwright verification/manual-result prompts share the wrapper. Test with `python operator_notifications.py --test`; set process environment `BACKLINK_NOTIFICATIONS=0` for offline tests. No credentials are included in notification messages. Browser mapping may resume; backlink publishing remains paused until requested.

The operator added a rule to skip any website reporting a banned or suspended account, record the reason, and never create a replacement account there. The access helper and layout inspector enforce this before and after account actions. Account restrictions remain separate from publication counts. Publishing is still paused at 48/100 during the full layout-mapping pass.

Latest access preference for mapping: use the shared workbook credentials across all websites, automate sign-in and recognized free registrations, and ask only for CAPTCHA/email verification rather than routine sign-in status. `site_access.py` implements known blog and ASP.NET login contracts, private pre-registration checkpoints and refusal of missing facts/payment controls. The pool mapper accepts `--workbook`; its default is the private campaign workbook. Unsupported account forms remain recorded gaps. Preserve `.local/site-access/` during transfer. Publishing remains paused at 48 while the mapping queue runs.

The operator subsequently requested mapping all pool website layouts before further publication, with human prompts for each access check. Publishing is paused at 48/100 after Royal Directory; Directory8 was left unsubmitted. Use `python map_websites.py --browser` to resume the read-only inspection queue. Its individual files in `mappings/layouts/`, index/progress and new pool layout columns distinguish observed blueprints from runtime adapters and incomplete access. Do not resume publication until the operator requests it. See `mappings/layouts/README.md` for limits and continuation commands.

Template detection is now available through `python template_detector.py` (saved evidence) or `python template_detector.py --scan` (read-only public HTTP checks). The 286-row pool has template columns and a Template Groups summary. Observations in `mappings/template_observations.json` distinguish known shared families, reference-only families, individual platforms, unmatched forms and unknown sites, with structural fingerprints and evidence provenance. Both publishers collect rendered form structure during preparation without saving field values or hidden tokens. A family match never enables a hostname or replaces live free-plan guards. Preserve this catalog in the private handoff and keep one catalog writer running at a time. The initial scan found 20 unmapped directory-form candidates, not 20 usable/verified publishing routes. Current registry coverage is 79 routes; the latest verified count is 46 after Alivelink. Read the journal for subsequent progress.

The campaign now has 45 independently verified individual public pages (55 remaining). Matching detail pages were recovered for Black and Blue, Blue Sparkle, Brown Edge, Alive 2, Arctic and Azure directories without reposting. Directory search accepts numeric listing IDs and derives a detail candidate when the native template omits its detail anchor; candidates still require independent verification. The operator explicitly accepts detail/category pages and excludes Latest Links/Search pages. The shared verifier checks this policy before navigation and after redirects. Offline validation: 45 tests passed. Read the journal for later progress.

Template-led continuation: Trafficdirectory independently verified, bringing progress to 47/100. Four new live-inspected native forms were mapped: royaldirectory.biz, directory8.org, directory10.org and directory9.biz. Directory 8 permits an optional blank reciprocal field; its mapping validates that explicitly. Current coverage is 83 routes (48 directories, 27 classifieds, eight individual platforms), with 203 pool sites needing mappings. Check the journal for newer publication outcomes.


## Confirmed mapping standard (2026-10-23)

- On EVERY website's first mapping, ask the operator to confirm Register and Post/Add Listing controls, even when detection is confident. Save exact labels, selectors or safe URLs, originating pages and navigation steps in `mappings/layouts/<domain>.json`. Existing inventories without confirmation remain provisional and are revisited on resume; explicit deferrals, bans, identity skips and inspection errors are preserved.
- Inspect posting routes after sign-in, including when the account adapter is unsupported or the authentication result is uncertain. A login problem does not prove that an observed Add Listing route is unusable. Buttons without safe navigation URLs are recorded for operator inspection, never blindly clicked as navigation.
- Strongest completion evidence is a public backlink independently verified under campaign rules. The mapping-only fallback is a validated final posting form, labelled **Final posting form reached; publication untested**. Template recognition, login, homepage access and saved entry points alone do not complete a mapping. No new publication is authorized by this status; publishing remains paused during the mapping pass.
- Mark **Access gap** only after rechecking registration, login AND posting routes, recording explicit blocking evidence, and asking the operator to confirm no usable route remains. Unsupported automation stays Needs mapping/review. Do not fabricate route outcomes or infer absence from a short navigation scan.
- First-mapping button confirmation and Access-gap confirmation are required operator questions in addition to CAPTCHA/email checks. Use the existing one-time Windows notification with sound for these waits.


## Multi-step directory observations (2026-10-24)

`mappings/template_profiles/php-link-directory-multistep.json` now links Directory6 and BestDirectory4You blueprints. Directory6 uses Select Category / Dynatree with operator-assisted selection; BestDirectory4You uses a visible CATEGORY_ID select. Both have a separate free listing-type choice before the final form. Wait for the next step's actual controls after navigation; immediate snapshots can still show the previous step. A sidebar password form does not establish a posting restriction. The inspector recognizes these posting steps before classifying account access.

BestDirectory4You's registration was submitted once after operator CAPTCHA entry; its outcome remains uncertain and protected privately. A recovery login returned No permissions set for this user, yet its visible posting route reached the free Regular Link form without confirmed authentication. Preserve these separate findings; do not recreate the account or claim publication from the blueprint. Login contracts include the inspected login.php variant; profile registration preserves the public mode=register and agreed=true flags and sources its Name field from the approved business name. No backlink was published during this mapping work.


## Automatic website error handling (2026-10-24)

The operator requests no confirmation for clear website errors on home, submission, account or other pages. Record the error and safe page URL, then skip to the next website. Do not classify these as Access gap. The mapping runner detects explicit error pages before asking for first-mapping controls. CAPTCHA and first-mapping control confirmations remain interactive. A warning beside a usable form is recorded while mapping continues; it does not by itself prove submission failure. Unconfirmed navigation stays Needs review, not a fabricated website error.


## One-run publication pass authorized (2026-10-24)

The operator resumed publishing and requested a one-time pass across all pool websites, mapping workflows as needed and retaining every error/skip and verified public URL. `uivision_publish.py --publish --all-sites` processes the entire eligible pool without stopping at the target; the campaign target remains 100. This flag applies only to the invocation. Preserve published/protected journal states and existing links; no blind reposts. Unimplemented routes still need a validated adapter or an explicit recorded skip, not a fabricated success. Continue free-only, operator verification and first-mapping control-confirmation rules.


21 previously confirmed native directory blueprints are now publishing contracts in `mappings/confirmed_directories.json`, loaded into LIVE_DIRECTORIES. Each references its saved live layout and an explicitly synthetic contract fixture (not captured site HTML; category IDs in fixtures are test-only). Existing native live guards remain mandatory at preparation and submission. Excluded campaign-incompatible URL-policy sites. Offline validation: 17 focused tests passed, including per-host fill, required reciprocal and changed-submit/action refusal checks. No publication is implied by route registration.

## Restored Chrome continuation (2026-10-27)

The Chrome extension was reinstalled and the existing bridge reconnected. Saved campaign progress reached 54 verified websites; inspect the journal for subsequent changes. Bestbuydir is pending. Smartseolink's interrupted submission and Colorblossom's unresolved submission remain uncertain and must not be reposted. Face-list was explicitly skipped by the operator. The Bizz Directory live form passed the optional blank reciprocal guard; its live override is in `confirmed_directories.json`, with a synthetic contract fixture and preserved extSource provenance. This changes an existing route, not the number of supported hostnames. All submission and independent verification guards remain required.

Greeny, Groovy and Fire Directory subsequently passed the same live optional reciprocal validation and have equivalent per-host overrides and synthetic fixtures. Fire retains its inspected free Regular links radio contract. Required reciprocal checks remain enforced; no reciprocal URL is invented or supplied. Existing imported source definitions and their hashes are preserved.

Linkedin-directory.com also has a live-inspected override for HTTPS and its optional blank reciprocal field; the original imported HTTP-only contract remains unchanged for provenance. Its synthetic fixture participates in the same required-reciprocal and changed-submit/action refusal checks.

Searchdomainhere.com's account/posting controls were confirmed by the operator and its final HTTPS submission form passed the optional reciprocal guard on 2026-10-27. Its override and synthetic fixture follow the same pattern; runtime validation and independent public verification remain mandatory.

Supervised multi-step publication on 2026-10-27 independently verified Directory6, Aweblist and Activ Directory detail pages, bringing saved progress to 57/100. Their public searches use `/search?search=...`, and detail routes use `/listing/...`; the native `index.php?q=...` discovery does not cover this family. Search pages remain discovery-only and never count. SEO Optimization Directory has a `Link submitted` receipt pending public verification; MediaFire Direct Link is uncertain and protected. Operator-submitted receipts were recorded without repeating a click. Per-site `supervised_publication` steps in `mappings/layouts/` document the free choice, category, fields and receipt. These are supervised workflows, not automatic queue adapters. Private `.local/prepare_aweblist.py`, `.local/submit_aweblist.py` and `.local/verify_public_candidate.py` support the inspected final forms; preserve them privately, and never rerun preparation/submission for protected journal records. BestDirectory4You's free Regular Link form in Cheerleading was prepared; consult the current journal before continuing.

BestDirectory4You's supervised submission returned no clear receipt and remains uncertain; do not repost automatically. Addirectory.org's Add Site control was confirmed by the operator, and its actual final form passed the native guard. A synthetic offline contract fixture and publishing contract were added for this new hostname. Consult its journal entry for the publication outcome; mapping alone does not count.

Addirectory.org subsequently independently verified, bringing saved progress to 58/100. Alive-directory.com's `ADD URL` control was confirmed by the operator and its final form passed the native optional reciprocal guard. Its native contract and synthetic fixture are saved. The layout inspector now recognizes ADD URL/URLs in addition to Add Site/Link, with regression coverage. A visible Smarty validator warning was recorded beside the usable form; it was not classified as proof of submission failure. Read the journal for its eventual outcome.

Alive-directory.com independently verified afterward, bringing saved progress to 59/100. Apeopledirectory.com's Add Site control was confirmed by the operator, and its final form passed the native guard without a reciprocal field. Its publishing contract and synthetic fixture are saved; read the journal for its outcome.

Aquarius-dir.com subsequently independently verified, bringing saved progress to 60/100; Apeopledirectory and Ask-dir rejected duplicate URLs without a verified matching result. These native forms now have operator-confirmed contracts and synthetic fixtures. Ask-directory.com's confirmed free form has two LINK_TYPE radios: normal Regular Reviews and reciprocal Regular Reviews. Its explicit per-host radio contract allows exactly those values, selects normal by name AND value, and requires that option to show a free price. Shared guards still reject changed values, unknown options, paid target prices and altered final actions. Both Ui.Vision and Playwright select the exact configured radio; additional alternatives are allowed only by an explicit per-site contract.

Ampblogs account continuation: its inspected `/login` form uses username/password/login; that contract now has offline coverage. A prior sign-in click missed an already visible KeyCAPTCHA widget. Account and layout detection now recognize `#KEY-Captcha` and `#logo_key_captcha`, with a rendered offline test proving detection without iframe or validation-error text. Always recheck verification after filling and before Sign in. The operator completes KeyCAPTCHA manually; no new sign-in/registration click is authorized while waiting for that action. Try supplied credentials first and inspect the actual result before concluding an account does not exist. Do not reload the page after the operator solves a challenge.

2026-10-28 account update: Ampblogs and Ampedpages reported account restrictions after supplied-credential sign-in and are protected skips. Bleepblogs login rejected the supplied credentials; its free registration field named username is labelled Blog Name despite HTML type=email. An initial registration received explicit Username should be alphanumeric validation. The operator authorizes blog names derived from the approved business name with spaces and punctuation removed: CLIENT_USERNAME. Use this public blog name for inspected blog-name controls and keep supplied login email/password for their respective fields. The operator subsequently authorized adding/removing letters as a fallback when a username already exists; the first Bleepblogs fallback is CLIENT_USERNAMEMO. Record rejected candidates and the actual per-site name privately, and never retry an uncertain or completed registration to try another name. This permission does not override bans, paid plans, CAPTCHA waits or email verification. The account contract is limited to the inspected Bleepblogs host; HTML input type alone does not establish field meaning. Private registration checkpoints and rejection evidence remain preserved.

Bleepblogs registration with CLIENT_USERNAMEMO succeeded. Its New Post controls were confirmed by the operator, and the classic editor published the approved public details with an exact clickable website link. The public post independently verified, bringing saved progress to 64/100. The platform publishes on the observed business subdomain. Campaign records can now explicitly store publication_host; the shared helper permits only the platform itself or its recorded direct subdomain, and counting uses the actual public hostname once. Unrelated/deeper/mismatching hostnames remain rejected. Both candidate-resume paths honor this recorded hostname; the verifier itself remains strict. The inspected editor guard is `mappings/wordpress_classic_guard.js`, with offline refusal tests; its per-site blueprint documents fields and the View your post receipt link. The supervised publishing helper is private at `.local/publish_bleepblogs.py`; Bleepblogs is not yet an enabled general queue adapter, and its published journal entry must not be reposted. Offline verification included 30 pool/publisher checks and 13 classic-editor/content/pool checks.

## Simplified workflow (2026-10-30)

The operator subsequently required the final tool to operate without AI or a coding assistant. The current Python publishing runner makes no model calls; remaining operational reliance on the assistant comes from unfinished mappings and unresolved cases. See WORKFLOW.md for the product requirement. The operator selected a native Windows app, automatic routine publishing, human verification/review prompts, and separate maintenance of unsupported workflows. See DESKTOP_APP.md for the implemented desktop entry point.

The operator chose a full-pool run, reuse of confirmed live-matching layouts, automatic read-only inspection of uncertain results, and bounded free account access. See [WORKFLOW.md](WORKFLOW.md) for the current entry point, account rules, diagram and output paths.

The browser launcher now defaults to the private project workbook and `--all-sites`; it was syntax-checked without being executed. `-StopAtTarget` remains available. Exact navigation/form matches can inherit button confirmation from an operator-confirmed completed workflow, with the source domain recorded. New/changed layouts still ask; templates never enable publishing adapters or replace live guards.

Account checkpoints permit one login, then recognized free registration after an explicit rejection. Taken blog names get up to three letter-suffixed variants, never another username login. An already-registered email always skips the website. CAPTCHA and uncertain results cannot replay a click. Account inspection rereads delayed responses; Chrome publication inspection reads receipts and recovers/verifies candidates. Both publishers pause if the result remains unclear; validated inspection resolutions are saved for reuse. Restricted accounts and older interrupted attempts remain protected. Blog-ezine is a suspended-account skip; Blog-gold's older account outcome must be inspected before any further action.

Validation for this simplification: 91 broad offline checks passed, followed by 15 focused layout checks including a new changed-confirmation regression. The PowerShell launcher passed syntax validation without execution. No live login, registration or publication was performed during these changes; saved progress remains 64/100.

## Native desktop app (2026-10-30)

`Start_Backlink_App.cmd` opens `Backlink_Publisher.pyw` / `backlink_app.py` without a terminal or AI service. The existing installed Python/Tk runtime is required; this is not a packaged EXE installer. The app selects client/pool XLSX files, loads the matching saved campaign, runs the existing full-pool publisher through a private subprocess, displays progress/outcomes, handles CAPTCHA/email/review actions, pauses cooperatively, and exports Excel/CSV reports. `desktop_runner.py` exchanges structured local messages; raw worker diagnostics stay in `.local/desktop/`. Neither opening the app nor choosing a workbook publishes.

Unresolved submissions can be rechecked, independently verified from an operator-supplied public URL, or explicitly deferred while preserving their original journal status. Deferral cannot reset/repost/count a result. Unsupported/changed workflows are saved as Needs mapping and skipped; layout inventory still does not enable an adapter. Human skips before a final submission remain skipped on resume. Individual-platform browser workflows can show a visible Chromium window for verification, while public verification remains independent. The current campaign was read through the native UI at 64/100, with 286 enabled pool sites and 118 coded workflows; no live publication was started during implementation.

Desktop validation: 110 offline tests passed, including native Tk window construction, real subprocess prompt/response transport, safe cancellation before submission, journal-preserving review deferral, unsupported-site continuation and public-only Excel exports. The desktop worker's actual Chrome connection check passed without navigation or publication. Connection detection now uses current browser-count evidence and ignores the bridge's historical `host not connected at hello time` note. No publishing/mapping workers remain running from implementation. Pythonw is available on this computer; the double-click launcher was prepared without starting a publishing run.

## Supervised publishing resumed (2026-10-30)

The operator deferred desktop-app work and resumed the Ui.Vision mapping/publication workflow. Blog-gold registration succeeded as CLIENT_USERNAMEA after an explicit taken-name rejection; the original post was completed by the operator and independently verified, bringing the campaign to 65/100. Its canonical campaign URL is `https://CLIENT_USERNAMEa.blog-gold.com/1542489/cheer-athletics-st-louis`.

The operator explicitly requested a live test post on this website, overriding the normal offline-only testing rule for this one diagnostic. The separate test independently verified at `https://CLIENT_USERNAMEa.blog-gold.com/1542520/cheer-athletics-st-louis-publishing-workflow-test`. Its checkpoint is private under `.local/publish-tests/blog-gold-publish-control.json`; it does not replace the original campaign record or count as a second hostname. Do not rerun that checkpoint or create more test posts without a new request.

The corrected workflow waits for the exact Publish control under `#publishing-action`, checks CSS/ARIA busy states in addition to the HTML disabled flag, uses a browser click, and waits for the correctly JSON-encoded View your post receipt locator. Captured events confirmed a trusted click on `publish` and a real form submission. The editor can normalize HTML; `mappings/wordpress_classic_content_guard.js` permits equivalent public text/block boundaries and identical links while rejecting changed text, changed URLs or active/hidden content. Seven focused offline checks passed. Reusable evidence is in `mappings/template_profiles/wordpress-classic-blog.json` and the per-site blueprints; `.local/publish_classic_blog.py` uses the corrected guards/action/wait. These supervised mappings still do not enable a general queue adapter for every blog hostname.

## One results CSV (2026-10-30)

The operator reported a stale results.csv and requested one results CSV only. The actual current data had been written to results-latest.csv while Excel previously locked the original. The original results.csv is now refreshed and contains 65 verified rows, including Blog-gold's canonical public URL in published_url. Former fallback CSVs were preserved in a verified private ZIP archive under `.local/report-backups/` and removed from the active campaign output folder. The exporter now always updates results.csv, prompting for Excel to close the file when necessary. Stopping or missing stdin pauses safely after saving the journal; a finally-block save does not repeat that prompt. No alternate results CSV or URLs-only CSV is created. Forty-two focused offline checks passed, including file unlocking/retry and safe pause without duplicate reports. Continue the supervised Ui.Vision workflow; the desktop app remains deferred.

## Shared-blog continuation (2026-10-30)

Blog2freedom and Bloggadores independently verified, bringing the saved campaign to 67/100. URLs are in the one active results.csv under published_url and in published_urls.txt. Blog2freedom's busy pre-click guard stopped before the action was executed; the same prepared post completed after a ready-state check, using the same campaign attempt. Bloggadores completed with the corrected common workflow.

The operator asked why publishing was slow. Actual automation bottlenecks were short account-response polling, missing CSS/ARIA busy checks, the earlier receipt-wait quoting bug, and a per-host registration allow-list despite identical fields. Registration matching now requires actual collected labels blog name / your email / password plus the inspected same-origin HTTPS POST /register structure; unknown labels/types/required fields still reject. Only those fixed semantic labels are collected; entered values stay private. Account inspection polls read-only for up to 20 seconds / 20 reads, stops promptly on clear outcomes, records timing/flags privately and never repeats the action. Forty-one focused offline checks passed.

Reusable supervised helpers are `.local/continue_blog_account.py`, `.local/inspect_classic_blog.py` and `.local/publish_classic_blog.py`. Publication requires an enabled pool entry, a saved validated classic blueprint, completed account access, and the actual live guards; it never enables a host from template inventory alone. Successful publication updates the individual blueprint automatically. `.local/continue_website.py blogminds.com` is currently waiting for a genuinely changed-layout confirmation: Log In /login and Create a Blog /signup. Earlier unresolved legacy account checkpoints, such as Blog5 or Bloggin-ads, remain protected and were not retried to force progress.

Blogminds' /login and /signup controls were then confirmed. Its one login outcome remains uncertain; no repeat login was attempted. The inspected /signup form uses email/password/username/signup with Username (Blog address) text and its own hostname suffix. The layout collector records only a fixed account-family marker for that observed purpose, and the account contract requires the matching HTTPS same-origin POST /signup structure. This is a different account template from /register. After an unresolved account outcome the mapper now excludes further account URLs while looking for actual posting routes, preserving the current response for inspection instead of losing it by opening signup/login again. Forty focused account/layout checks passed. The Blogminds signup is filled but unsubmitted, and the operator is being asked to complete CAPTCHA and explicitly choose registration because its prior login outcome was not established.
