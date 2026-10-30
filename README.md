# Local backlink publisher for Windows

For current workbook placement, Ui.Vision operation, pause/resume, and output instructions, see [OPERATING_GUIDE.md](OPERATING_GUIDE.md). The operator is currently using the supervised Chrome workflow; the Windows GUI remains deferred.

Double-click **Start_Backlink_App.cmd** to open the native Windows app. Choose a client XLSX, connect Chrome, click Start / Resume, and export Excel or CSV results. See [DESKTOP_APP.md](DESKTOP_APP.md) for setup and use. No AI account, model API key, paid AI service or coding assistant is required to operate it.

The app runs deterministic saved workflows through regular Chrome/Ui.Vision and Playwright. It preserves the workbook and saved campaign, pauses for human verification or unresolved results, marks unsupported workflows Needs mapping, and separates independently verified URLs from all outcomes. It uses installed Python/Tk; it is not a self-contained EXE installer.

**Transferring this project? Start with [HANDOFF.md](HANDOFF.md).** It covers private transfer, prerequisites and preserved progress. [WORKFLOW.md](WORKFLOW.md) describes current decisions. [AGENTS.md](AGENTS.md) preserves rules for future maintenance. The existing campaign credential workbook is `.local/workbooks/Cheer_Athletics_St_Louis.xlsx`; it requires a separate private transfer and is not included in Git.

**Coverage is partial.** At the 2026-10-30 desktop checkpoint, the pool has 286 websites and 120 registered main-runner routes plus 19 supervised classic-blog workflows; 147 pool sites still need executable workflows. Live availability and new-client compatibility vary. A saved layout alone is not a working publishing adapter. Read current progress files for the actual count; the saved Cheer Athletics checkpoint is 83/100.

## Website pool, target and confidence

Add publishing URLs to [websites/Website_Pool.xlsx](websites/Website_Pool.xlsx), on the **Websites** sheet. Edit Website, Enabled and Notes. The desktop app and regular-Chrome launcher use full-pool mode: the target remains 100 verified websites, including existing matching results, but the run continues through the enabled pool. Business-specific credentials come from the client XLSX; `Enabled=No` there remains an exclusion.

The pool ranks sites using `100 * (successes + 1) / (successes + errors + 2)` and displays the sample counts and evidence level. Untested rows are Unrated. Existing recovered links and deferred/waiting tasks are separate from publishing successes/errors. Per-campaign SQLite histories prevent repeated saves or verification checks from adding fake attempts. Initial history is one saved observation per site, not a reconstructed retry log. Scores combine campaign histories across businesses.

Run `python website_pool.py --refresh` with the XLSX closed to update scores while preserving your input columns. Both publishers refresh it after a run. `progress.json` records the target, verified count and shortfall. If workflows run out before 100, the app reports the remaining number; it does not count failed or pending submissions. See [websites/README.md](websites/README.md) for scoring rules, limits and commands.

The pool also shows template families, structural groups, match strength, evidence and inspection status, with a **Template Groups** summary sheet. Run `python template_detector.py` to use saved forms, or `python template_detector.py --scan` for read-only HTTP checks of enabled pool sites. Use `--only example.com` to narrow a scan. Both publishers record rendered form structure during preparation. Detection identifies reuse opportunities; it never enables an adapter or changes publishing confidence. See [template detection](websites/README.md#template-detection).

To map layouts across the entire pool without publishing, run `python map_websites.py --browser`. It resumes the regular-Chrome inspection queue, asks for access checks, and saves one blueprint per website in [mappings/layouts/](mappings/layouts/README.md). The pool shows layout status, posting entry point, access and blueprint path. Saved structure and form blueprints remain distinct from tested runtime adapters.

Windows interaction prompts show **one desktop notification with sound** when CAPTCHA, email verification or another operator action becomes necessary. Notifications do not repeat while that prompt is waiting, and they never answer it or move the browser. Run `python operator_notifications.py --test` to test delivery. No additional packages are needed. Set `BACKLINK_NOTIFICATIONS=0` in the process environment to silence alerts during offline tests.

Options: `--pool path.xlsx`, `--target 100`, or `--workbook-sites-only` for the original workbook-only queue. The regular-Chrome runner uses Ui.Vision for directory/classified mappings and delegates individual platforms to Playwright or the official API; unresolved human checks there are deferred. Telegraph's new free API workflow follows its [official documentation](https://telegra.ph/api); local live DNS access failed, so its status remains unverified.

## Setup

Use Python 3.10 or newer. In PowerShell, from this folder:

```powershell
python -m pip install -r requirements.txt
python -m playwright install chromium
```

Python dependencies and Chromium were installed on the source machine. Reinstall them on the recipient computer; browser downloads, Chrome sign-ins and the Ui.Vision connection do not transfer as running sessions. Node/npm and the pinned local bridge are needed for regular-Chrome automation; setup is in [HANDOFF.md](HANDOFF.md).

## Excel templates

Use `templates/Backlink_Template.xlsx` for a new business. `templates/Cheer_Athletics_Example.xlsx` shows the supplied public business details and confirmed hours in this layout. The distributed blank template contains the original 95 domains with credentials blank; the public-data example is available in the private working copy only. The blank template leaves hours unknown; the example uses separate ASCII `HH:MM` values: Monday-Thursday 15:00-21:00, Friday/Saturday Closed, Sunday 12:00-21:00.

| Sheet | Where to enter data |
| --- | --- |
| Business | Column B beside each field label: name, website, approved descriptions, address components, phone, email, category, keywords, time zone, logo, and social profiles |
| Hours | One row per weekday: Status, Opens and Closes. Use 24-hour `HH:MM`; leave times empty for Closed, 24 hours, or By appointment |
| Sites | One row per target domain: Listing site, Username, Password, Login email, and Enabled = Yes/No |
| Instructions | Filling instructions and commands; not read as business content |

Required business values are **Business name, Website, and Description**. Individual sites may also require address, phone, category or other details. Keep sheet names and field labels. The reader identifies Business fields by label and Hours/Sites columns by header, so their order can change. The active tab does not matter. Phone numbers and postal codes are formatted as text to preserve country prefixes and leading zeros. Paste values rather than formulas.

Hours have status dropdowns and time-entry validation. Put `15:00` in Opens and `21:00` in Closes instead of pasting `3-9 PM` into one cell. The script creates ranges with standard ASCII hyphens. Closed, 24 hours and By appointment need empty time cells; blank status means unknown. For overnight hours use the actual closing time, such as 22:00 to 02:00. Native Excel time values are also accepted. Paste/import can bypass Excel validation, so run the validation command below to catch invalid cells before publishing.

The reader recognizes hours, logo and social fields, but each publishing workflow still submits only the fields it supports. Adding data to the template does not add website coverage. An optional Short description is used by IKEandED; otherwise the tool shortens the first approved sentence.

Validate a completed copy without accessing any site:

```powershell
python backlinks.py "your-business.xlsx"
```

Regenerate templates with a source workbook's public details and target domains (credentials are never copied):

```powershell
python workbook_layout.py --source "source.xlsx"
```

## Run

Inspect all target sites without submitting:

```powershell
python backlinks.py .\.local\workbooks\Cheer_Athletics_St_Louis.xlsx --audit
```

Create listings using the implemented flows:

```powershell
python backlinks.py .\.local\workbooks\Cheer_Athletics_St_Louis.xlsx --campaign default --target 100 --publish
```

To use another business, fill a copy of the standard template described above. The original single-sheet layout is also supported: the tool detects the `Listing Sites` header; business fields come from column A labels and column B values above that header, with the business name in B1. The account username, password, and login email come from columns D, E, and F. Existing `Live` statuses and previous links do not prevent a new campaign submission.

Useful options:

```powershell
# Run selected enabled pool sites only.
python backlinks.py "business.xlsx" --publish --only rentry.co postheaven.net

# Open Chromium and pause when CAPTCHA is detected.
python backlinks.py "business.xlsx" --publish --interactive

# Explicitly start another campaign for the same business.
python backlinks.py "business.xlsx" --publish --campaign november-2026

# Select a worksheet by name.
python backlinks.py "business.xlsx" --sheet "Sheet1" --audit
```

Without `--audit` or `--publish`, the tool validates the workbook/pool and writes local result/progress files, preserving any existing journal. No site is submitted. `python uivision_publish.py <workbook>` also previews the ranked queue and prints the verified count.

## Guided interactive sessions

For the regular-Chrome Ui.Vision pilot, see [BROWSER_HELPER.md](BROWSER_HELPER.md).
`browser_helper.py` exports public workbook data and imports independently verified
result URLs into the existing campaign. Its export command never publishes.
For continuous mapped-site automation through regular Chrome, use the direct
Ui.Vision connection and `Start_Browser_Automation.ps1` described in that guide.

Run `Start_Interactive.ps1` in PowerShell for a visible terminal and browser. Always pass `-Workbook` on the recipient computer; the omitted-workbook launcher default still refers to the original Downloads filename. The shared pool runs in confidence order. `-StartWith` changes the first site but does not limit the rest of the queue:

```powershell
.\Start_Interactive.ps1 -Workbook .\.local\workbooks\Cheer_Athletics_St_Louis.xlsx -Target 100 -StartWith "rentry.co"
```

At a CAPTCHA prompt, complete the challenge and press Enter **in the PowerShell window**. If refreshing cleared the form, type `refill` to restore the approved details. If the automated browser cannot pass verification, type `manual` to enter guided completion. No automatic solver or verification bypass is provided.

Interactive mode also stops at unsupported sites, previous uncertain submissions, and failed automatic flows instead of silently skipping them. Complete the form in the open browser, then paste its **public result URL** into PowerShell. The tool independently verifies it before counting it. Other commands at that prompt:

- `current`: verify the page currently open in the automated browser.
- `browser`: open that site in your regular default browser; complete the form there and paste its public result URL back into PowerShell. Credentials and session cookies are not transferred.
- `pending`: record that the site is awaiting approval.
- `skip`: move on without counting a backlink.
- `stop`: save progress and end the session.

Previously verified publications are still skipped. If an earlier submission is uncertain, inspect the account for its public result before creating another. A new workbook or interactive mode does not automatically add missing reusable site workflows or guarantee that every site accepts a listing. Paid-only sites, unavailable sites, account restrictions, and failed verification may remain incomplete.

If Excel has `results.csv` open, the tool writes `results-latest.csv` instead, or a numbered report if both are locked. The journal and verified URL list continue updating.

## Output

Each business and campaign gets its own folder under `output/`:

- `published_urls.txt`: one verified public backlink URL per line, deduplicated.
- `results.csv`: selected pool sites and earlier journal sites, status, URL, reason, timestamp, and detected `nofollow`/`noindex` settings. Workbook-only mode retains original rows and flags repeated domains.
- `state.json`: submission journal used to resume without blindly reposting.
- `attempts.sqlite3`: per-campaign confidence observations; preserve this during transfer.
- `campaign_settings.json` and `progress.json`: distinct-site target, verified count, remaining count and mapping-capacity gap.
- `audit.json`: read-only HTTP discovery, response errors, form fields, and CAPTCHA markup. HTTP failures alone do not establish that a site is permanently unavailable; browser access can differ.

The final CSV labels failed, rejected, blocked/needs-attention, unverified and uncertain results as `error`, with the explanation in `reason`. Verified links remain `published`; submissions awaiting approval remain `pending`. Unprocessed or in-progress rows keep their status. `workflow_status` preserves the detailed internal status, and `duplicate` identifies repeated workbook domains. The journal retains its original states so error reporting never authorizes an automatic repost.

Existing public listings may also be recovered at the user's request. They must match this business and its exact approved website URL, not merely another location on the same website hostname. Once verified, they join `published_urls.txt` and have `listing_origin=existing` in the CSV. Older records may have an empty origin field. A duplicate rejection alone is not proof of a matching public listing; read-only searches never create or edit a listing.

`published` means a fresh browser context, without the publisher's cookies, could see the business name and a visible clickable anchor to the exact website URL. For IKEandED's tracking link, the tool checks the HTTP redirect destination; `redirected` is recorded in the CSV. Plain URL text, private pages, edit links, and pending submissions are excluded. This check does not establish Google indexing, permanence, or ranking benefit. Check the `noindex` and `nofollow` columns.

## Mapping files

All reusable form mappings are in [mappings/](mappings/README.md). The [site index](mappings/sites.csv) covers all 95 distinct workbook domains and separates reusable code from interactive recipes, inspection limitations and unmapped sites. Root launch commands and campaign output paths are unchanged.

## Implemented flows and limits

| Platform | Flow | Limit |
| --- | --- | --- |
| Rentry | New Markdown page with a generated URL and private edit code | Public link verified in the live run; page had `noindex` |
| Postheaven | Login with workbook credentials; post to an existing blog matching the username | Public link verified in the live run; current link had `nofollow` |
| WriteABlog | Login with workbook credentials; select an existing public blog matching the username; publish approved Markdown | Public article independently verified. A nonempty editor draft stops preparation; no automatic repeat after submission |
| IKEandED | Login; select only the explicitly free Basic 5 Day Listing; fill US business details | Public listing and redirect verified in the live run. Short description uses the first approved sentence; US address and category mapping required; listing expires after five days |
| Pastelink | New public post, custom URL, edit code | CAPTCHA detected; unattended completion unavailable |
| Padzee | Save a public note with a generated name | The live note saved but did not render a clickable backlink; excluded from published URLs |
| JustPaste.it | TinyMCE article editor using approved text and website link | Publication was attempted but a public result URL was not recovered; retained as uncertain and excluded |
| Classifieds family | 27 domains listed in `mappings/registry.py`: select a US state, Services > Health & Fitness, then fill a free ad | Sports/fitness category mapping only. Both paid promotion controls are explicitly set to None; site acceptance and a verified public result are still required |
| PHP directory family | Fill title, website, description, organization/email, and a matching category on `/submit.php` | Attempted on the domains in `DIRECTORIES` in the code. May require CAPTCHA, reciprocal links, moderation, or custom category mapping. Not every domain's end-to-end publishing is validated |
| Other workbook domains | Interactive recipes, inspection notes, or unmapped | See [mappings/sites.csv](mappings/sites.csv) and [interactive workflow notes](mappings/interactive-workflows.md); these notes are not executable adapters |

The tool uses only the approved description and contact data. It does not invent long articles, claims, a contact person's name, geographic coordinates, reciprocal links, or missing verification codes. The legacy loader normalizes hour-range separators to user-confirmed standard hyphens. Other damaged source text is omitted and reported. Existing contact/profile details on a logged-in account may be supplied by that site.

## Verification and resuming

Re-run the same command to resume. Verified publications are skipped. A saved candidate URL is rechecked without submitting again. Jobs marked `submitting`, `pending`, or `uncertain` are not automatically repeated, since the site might already have accepted them.

This applies to both the Playwright runner and the Ui.Vision queue. Ui.Vision preview labels saved candidates for rechecking; actual verification runs when operations resume. Category matching and editor synchronization improvements are internal and require no XLSX layout or launch-command changes.

If an interrupted process leaves a `.lock` file, first make sure no publisher is still running, then remove that campaign's `.lock` file. Before removing an uncertain entry from `state.json` to retry it, inspect the site/account and confirm whether it created a listing. Do not delete the entire journal to fix one failed site. Use a new campaign name only when you intentionally want new submissions again.

CAPTCHA, email codes, phone verification, and account checks cannot be guaranteed to run unattended using free Playwright alone. The current tool does not connect to an email inbox. With `--interactive`, it can pause for a detected CAPTCHA; you complete the challenge in the browser and press Enter in the terminal. It does not wait for editorial approval or count submission receipts as published backlinks.

Keep `.local/` private: it holds generated edit codes/tokens, diagnostics, the local bridge and the portable credential workbook prepared for the trusted handoff. Credentials are not copied into source code or public result files. The workbook, private directory and output directory are excluded from Git, so transfer them explicitly with the full private project. The original Downloads workbook remains unchanged.

## Tests and extending coverage

```powershell
python -m unittest -v
```

The checks use a synthetic workbook and locally intercepted browser pages; they do not publish anything. They check parsing, canonical domain duplicates, credential-free exports, locking, and rejecting non-clickable, hidden, incorrect, private, or edit-page links.

For another site, inspect its actual new-listing flow, then add a branch in `mappings/playwright.py:prepare()` and its domain in `mappings/registry.py:SUPPORTED`. Regular-browser family mappings live in `mappings/uivision.js`. A branch fills approved fields and returns the exact final publish control and, where possible, the future public URL. The runner journals before clicking, then verifies the public page. Add site-specific result URL extraction when the site returns a success dialog instead of navigating. Do not enable a flow merely because its homepage loads.

Reference: [Playwright Python library documentation](https://playwright.dev/python/docs/library).

Long text fields include all available public client details, including hours, social links and keywords. Declared character limits prioritize name, website and contact details before the description and remaining fields. Only description prose may be shortened; contact values and URLs stay whole. New result rows report `omitted_fields` and `content_notes`. The change applies to future submissions and does not rewrite existing publications.

For supported PHP directories, receipt and duplicate handling now attempts a read-only exact-destination search for linked detail pages before leaving an outcome pending/rejected. Both publishers independently verify any discovered detail page and preserve candidates when verification fails. This also applies during resume without reposting pending/rejected/uncertain records. Other platforms and directory layouts still need their own lookup workflows.

## Source distribution and private state

This repository includes source, reference fixtures, saved mappings, tests, a blank client template, and a clean website pool. It excludes `.local/`, `output/`, client workbooks, credentials, and recovery files. The shared supervised blog helpers are in [tools/](tools/README.md); they are separate from the standard launcher and currently target the private campaign workbook. The main runner supports its registered workflows. The default Cheer Athletics workbook is private: new operators must pass their own completed workbook with `-Workbook`.
