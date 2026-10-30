# Ui.Vision pilot: regular Chrome + Python results

New operator or computer: follow [HANDOFF.md](HANDOFF.md) first to restore the 36/100 campaign, its workbook, private recovery files and confidence history. Install the runtime and extension on the new machine, then reconnect as described here.

## Direct browser automation (after the Pastelink pilot)

The CSV pilot worked: Pastelink's public URL was independently verified and saved.
For continued work, use the direct connection instead of importing a new macro
for each site. `uivision.py` uses the official pinned Ui.Vision MCP bridge installed
locally under `.local/uivision-bridge`; it does not modify Codex or other app settings.

```powershell
# Install once, if it is not already installed in this workspace.
npm install --prefix .local/uivision-bridge --no-audit --no-fund --ignore-scripts uivision-mcp-bridge@1.7.20

# Keep this connection running in one terminal.
python uivision.py --connect
```

In Ui.Vision, click the bottom-right gear, open **AI**, enable **MCP bridge**,
keep port **50888**, and click **Test**. Keep the side panel open. Current store
versions pair automatically; do not copy account credentials into these settings.
The connection command itself never navigates or submits anything.

Then run `Start_Browser_Automation.ps1` in a second PowerShell window, or:

```powershell
$workbook = Join-Path $PWD '.local\workbooks\Cheer_Athletics_St_Louis.xlsx'
python uivision_publish.py $workbook --publish
```

This runner automates **48 directory and 27 classifieds mappings**
in regular Chrome and delegates eight individual platform routes to Playwright/API.
It uses **websites/Website_Pool.xlsx**, ordered by confidence, and stops at 100
verified distinct websites including existing matches. Edit Website, Enabled and
Notes on its Websites sheet; keep business details and credentials in the business XLSX.
For this campaign, already published, pending, rejected,
unverified and uncertain jobs are skipped. On a CAPTCHA prompt, solve it in Chrome and press Enter
in the terminal; `skip` continues to another site and `stop` ends the session.
After CAPTCHA it clicks the mapped final submit control automatically, captures
public result URLs, independently verifies them and updates the existing reports.
Both classifieds promotion options must remain **None**. Sites asking for a
reciprocal link are left for attention. Unmapped sites need an added workflow.

For a preview with no connection or publication, omit `--publish`. To run one site,
add `--only letspostfree.com`. The browser workflows have offline fixture checks;
each site's actual acceptance still depends on live access, current form fields
and site moderation. A coded mapping does not mean a live submission succeeded.
See [websites/README.md](websites/README.md) for scores, the target, and refreshing
the list. Individual Playwright workflows may need a separate interactive session
for CAPTCHA; the Chrome batch defers those checks and continues.

The runner journals before clicking. If a connection is lost during submission,
it preserves an uncertain/in-progress status and will not automatically submit
again. Stop with Ctrl+C in the terminal; Ui.Vision's own Stop button also halts
the running macro. Do not run the old Playwright publisher concurrently.

Official [Ui.Vision connection guide](https://github.com/A9T9/RPA/blob/master/mcp/README.md).

## CSV pilot (manual import/export)

The bridge is implemented in `browser_helper.py`. It reuses the workbook parser,
campaign folder, progress lock, public-page verifier and reports from `backlinks.py`.
Exporting does not open a browser, contact websites or change publication status.
Importing only visits supplied public URLs to verify them; it never submits forms.

## 1. Prepare the pilot

From PowerShell in this project:

```powershell
$workbook = Join-Path $PWD '.local\workbooks\Cheer_Athletics_St_Louis.xlsx'
python browser_helper.py $workbook --export --only pastelink.net
```

Use the same workbook and `--campaign` as the existing publisher. The default is
`default`. A new campaign intentionally allows new submissions. For a different
business, use its filled XLSX template. Omit `--only pastelink.net` to export all
unfinished domains; the only supplied form-filling macro is the Pastelink pilot.

The output path is printed. Its `helper` subfolder contains:

- `helper_queue.csv`: named columns, one row per unfinished domain, all public
  business fields including address parts, category, hours, logo and social URLs.
  `action=review` identifies earlier uncertain, pending or otherwise unresolved work.
  This file is machine input; do not use Excel to resave it (phone numbers and text
  must remain exact). Use the main `results.csv` report for spreadsheet viewing.
- `pastelink_job.csv`: one headerless row for the pilot. Columns are campaign ID,
  domain, business name and approved public submission text. Import this file into
  Ui.Vision, not `helper_queue.csv`.
- `Pastelink_Fill.json`: guided title/body autofill, with pauses for checking prior
  work and browser verification. It does not click Publish.
- `Pastelink_Capture_URL.json`: saves the active tab's URL as a candidate result.
- `helper_results_template.csv`: optional header-only template for manual results.

Account passwords, usernames, login emails and private edit codes are not exported.
Sign in within your regular Chrome browser when needed. Keep publishing in the old
Playwright runner stopped while working through the helper queue. The campaign lock
protects exporter/importer runs; it does not span manual work in the extension.

## 2. Import into Ui.Vision

Install [Ui.Vision from the Chrome Web Store](https://chromewebstore.google.com/detail/uivision/gcbalfbdmfieckjlnblleoemohcganoc)
in the regular Chrome profile where verification worked.

1. Open Ui.Vision and import both JSON files as macros.
2. In its CSV tab / CSV Manager, import `pastelink_job.csv`.
3. Check your earlier Pastelink attempt. If a public post already exists, open that
   post and go straight to capture; creating another is unnecessary for this pilot.
4. If no earlier post exists, run `Pastelink_Fill` using **Play**, once. Read each
   notification and press **Resume** at its pauses. Complete browser verification
   before resuming the form-filling step.
5. Finish options, confirm public visibility, retain any edit code privately, and
   submit the form yourself. The macro fills only the title and approved body;
   it does not configure a custom URL, edit code or visibility controls.
6. Open the **public result page** in the active Chrome tab and run
   `Pastelink_Capture_URL` using **Play**, once.
7. Export `helper_results.csv` from the CSV tab to Downloads. Use the actual
   downloaded filename if Chrome adds a suffix such as `(1)`.

If refreshing clears the form, rerun the fill macro only before a submission has
been accepted. If a submission is awaiting approval, record `pending` rather than
capturing the submission receipt. See the manual CSV format below.

The macros are generated from the existing Pastelink field mapping and checked
offline. The extension workflow still needs a live pilot in your regular browser;
Cloudflare or a changed site form can prevent completion.

## 3. Import and verify the public URL

```powershell
$workbook = Join-Path $env:USERPROFILE 'Downloads\Copy of 100 CITATION _ Cheer Athletics-St. Louis (1).xlsx'
$results = Join-Path $env:USERPROFILE 'Downloads\helper_results.csv'
python browser_helper.py $workbook --import-results $results
```

Only a public page with the business name and a visible clickable link to the
business website is counted. An independent browser context performs the check.
If verification fails or is challenged, the URL remains `unverified`; reimport
the same CSV to retry without creating a new post. Existing `published` results
are preserved. An interrupted import saves its candidate before checking it.

Final reports remain in the existing campaign folder:

- `published_urls.txt`: verified URLs, one per line.
- `results.csv` (or `results-latest.csv` if Excel has the main file open).
- `state.json`: progress for safe resuming.

## Results format and expanding to other sites

Results have four columns, with an optional header:

```csv
campaign_id,domain,outcome,public_url
YOUR_EXPORTED_CAMPAIGN_ID,pastelink.net,candidate,https://pastelink.net/PUBLIC_POST_ID
```

Use the exact campaign ID from the exported queue. Outcomes are `candidate`
(requires a complete public URL), `pending`, or `skip` (both require a blank URL).
The capture macro writes headerless rows with this same order. Repeated identical
rows are deduplicated; conflicting results for one domain reject the whole batch
before any state changes. Wrong campaigns, unknown domains, homepages, edit pages
and URLs outside the expected listing domain are rejected.

For another site, create and test its own Ui.Vision macro using the public fields
from `helper_queue.csv`, then output these same four result columns. CSV export
does not automatically map the forms on the remaining websites. No FileAccess
XModule or paid service is required for the manual CSV import/export workflow.

Official command references: [csvRead](https://ui.vision/rpa/docs/selenium-ide/csvread),
[csvSave](https://ui.vision/rpa/docs/selenium-ide/csvsave),
[pause / Resume](https://ui.vision/rpa/docs/selenium-ide/pause).

Helper exports now include `combined_content` and source `omitted_fields`. The Pastelink pilot CSV has six columns: campaign, domain, title, combined public text, UTF-16 text length and source omissions. Re-export and import the matching CSV/macros together. The manual pilot stops if its combined content exceeds a declared field limit; use the batch publisher for automatic fitting and omission reporting. The Playwright and Ui.Vision batch runners fit long fields automatically and append omission notes to the results CSV.
