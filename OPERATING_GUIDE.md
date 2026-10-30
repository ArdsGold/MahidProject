# Operating the Windows backlink publisher

This repository contains the Windows tool source, saved mappings, tests, a blank workbook template, and a clean website pool. Client credentials, campaign history, raw browser diagnostics, and recovery files are excluded. For an existing campaign, obtain its private files separately from the trusted owner.

## Prepare a client workbook

Use `templates/Backlink_Template.xlsx`. Its Business sheet starts at row 1 and matches the uploaded citation document exactly for the first eight rows:

| Row | Business field |
| --- | --- |
| 1 | Business name |
| 2 | Address (full address in one cell) |
| 3 | Phone |
| 4 | Website |
| 5 | Description |
| 6 | Category |
| 7 | Business hours (all weekdays in one multiline cell) |
| 8 | Keywords |

Copy the source document's first eight values into **Business!B1:B8**, or paste its first eight label/value rows into **A1:B8**. Use Excel's Paste Values. Colon-suffixed labels are accepted. For multiline values, copy the Excel cell itself rather than unquoted tab-separated text. Keep each description/hours block inside its single cell.

- **Business!B9:** optional fallback categories, one per line or separated by semicolons, in priority order. The primary Category stays in B6. Only actual enabled site options are used; ambiguous matches require review.
- **Business!B10:** optional public business email. B11 is the optional time zone. Expand the collapsed optional rows for socials, services, and address components when needed.
- **Account!B2:B4:** shared Username, Login email, and Password, entered once. These are private and never part of published content.
- **Sites:** optional client-specific websites and Yes/No exclusions only. Leave blank to use `websites/Website_Pool.xlsx`. No credentials are repeated here.
- **Overrides:** optional per-site account differences only. Enter Listing site, Username, Login email, Password. Blank credential cells inherit Account. An override never re-enables a disabled website.

Save the completed copy as `.local/workbooks/Your_Client.xlsx`, then run:

```powershell
.\Start_Browser_Automation.ps1 -Workbook ".local\workbooks\Your_Client.xlsx"
```

Hours accept full weekday lines such as `Monday 7 AM-8 PM`, `Tuesday Closed`, or `Sunday 10 PM-2 AM`. Unicode dash variants and narrow spaces from Excel are normalized to safe ASCII time ranges. Missing days remain unknown; ambiguous times, repeated days, or invalid values produce a correction message before publishing. Full US addresses matching `street, city, ST ZIP` are parsed without changing the approved address; other formats can use the optional address component fields.

`templates/Mobile_Battery_Example.xlsx` and `templates/Cheer_Athletics_Example.xlsx` demonstrate the new layout with approved public details and **no login credentials**. Old four-sheet templates and original single-sheet citation workbooks remain readable. Recognized BACKUP SITES headings are treated as section headings, not website hostnames.

Keep credentials and completed client workbooks private. Close Excel before starting the publisher. Creating or validating a workbook does not publish anything.

## Set up the full private project

Use Python 3.10 or newer, Node.js/npm, and regular Google Chrome with Ui.Vision installed. Run these commands from the full project folder on a new machine:

```powershell
python -m pip install -r requirements.txt
python -m playwright install chromium
npm install --prefix .local/uivision-bridge --no-audit --no-fund --ignore-scripts uivision-mcp-bridge@1.7.20
```

Run these commands in the cloned project folder. Chrome sessions, extensions, Python environments, and running bridge processes do not transfer automatically between computers.

## Connect the browser

In PowerShell inside the full project folder:

```powershell
python uivision.py --connect
```

In Ui.Vision, open Settings (gear) > AI, enable MCP bridge, and use Test. Keep the panel and this terminal open. Its AI settings page hosts the bridge switch; deterministic runner commands do not require an AI account or model key.

Use one designated automation tab. Keep the intended Chrome profile connected. If several browser connections are present, have the operator or maintainer explicitly select the intended connection before publishing; the launcher does not pin a browser by itself.

## Preview without publishing

In another PowerShell terminal:

```powershell
python uivision_publish.py ".local/workbooks/Your_Client.xlsx" --pool "websites/Website_Pool.xlsx" --target 100
```

Omitting `--publish` produces a preview and local reports, without publishing. Check the business identity, pool, and restored progress first.

## Start or resume publishing

For a new client workbook:

```powershell
.\Start_Browser_Automation.ps1 -Workbook ".local\workbooks\Your_Client.xlsx"
```

For the existing Cheer Athletics campaign:

```powershell
.\Start_Browser_Automation.ps1
```

The launcher defaults to the existing Cheer Athletics workbook and processes the enabled supported pool even after 100 verified websites. To stop at the target instead:

```powershell
.\Start_Browser_Automation.ps1 -Workbook ".local\workbooks\Your_Client.xlsx" -StopAtTarget
```

To select one enabled website:

```powershell
.\Start_Browser_Automation.ps1 -Workbook ".local\workbooks\Your_Client.xlsx" -Only example.com
```

Only run one publisher per campaign. The current supervised workflow uses Ui.Vision in regular Chrome; the separate Windows GUI is deferred in the operator's current workflow. The launcher executes registered adapters. The supervised helpers in `tools/` and new or changed mappings still require a maintainer; the launcher is not a universal publisher for every pool row.

## Respond to prompts and pause safely

- The tool sends one Windows notification with sound when interaction is needed.
- Complete CAPTCHA and email verification directly in Chrome. Keep verification codes out of chat.
- Wait for the challenge to finish, then return to the terminal and press Enter. Leave final account and publication buttons for the runner unless explicitly instructed otherwise. Avoid refreshing a filled form.
- Type `skip` to move on or `stop` to pause at a prompt. In an assistant-supervised session, say Pause; the assistant stops the waiting runner and preserves progress. Wait for it to stop before shutting down the PC.
- Resume with the same workbook and campaign. Do not delete checkpoints or create another campaign to force a retry. An uncertain final action must be inspected before another submission.
- If `results.csv` is locked, close it in Excel and let the same report update. Do not create alternate result CSVs.

Account handling uses supplied credentials, one login followed by registration only after explicit rejection. Taken blog names can use up to three modified variants; an already-registered email or suspended account skips the site. CAPTCHA is always completed by the operator. A one-time fresh login for older unresolved checkpoints was separately authorized for the current campaign; it does not permit repeating new uncertain attempts.

## Read results

Each client/campaign has its own output folder. The current Cheer Athletics folder is:

```text
output/cheer-athletics-st-louis-97799292ece7/
```

- `results.csv`: the single active results CSV. `published_url` contains independently verified public URLs. Errors, skips, rejections, and unresolved outcomes retain their reasons; pending submissions do not count.
- `published_urls.txt`: verified URLs only.
- `state.json`, `attempts.sqlite3`, `campaign_settings.json`, and `progress.json`: durable campaign state and history.

Verification requires the business name and a visible clickable link to the exact approved destination. Eligible public detail or category pages count; receipts, previews, Latest Links, Search pages, and another business location do not. Multiple posts on the same normalized hostname count once.

## Current checkpoint and limitations

At the saved 2026-10-30 checkpoint, the private campaign has 83 verified websites out of a target of 100. The enabled pool contains 286 websites. There are 120 registered main-runner routes and 19 additional supervised classic-blog workflows, for 139 executable workflows. Workflow availability does not guarantee a successful submission or a reusable result for another client. Read the actual journal and registry for newer counts.

Visiting a site, saving buttons, reaching login, reaching a final form, and implementing a publishing adapter are different milestones. Do not report all visited sites as fully mapped. Unknown or changed forms need mapping; website errors are recorded and skipped. Saved candidates and pending/uncertain submissions are checked without reposting.

Several inspected Localzz sites require payment for clickable website links. Others have not had their plans verified. A network-wide exclusion was discussed but has not been applied: set Enabled = No for the selected pool rows to implement it. Distinguish an operator exclusion from a confirmed paid plan.

## Private transfer and maintenance

Keep credentials, client workbooks, raw authenticated diagnostics, edit tokens, and campaign output private. Preserve the entire `.local/` and `output/` folders during a trusted private handoff. Do not publish them to GitHub. The repository includes only `templates/Backlink_Template.xlsx` and a clean `websites/Website_Pool.xlsx`. Other XLSX files remain ignored. Existing client files and campaign progress require a separate private transfer.

The saved workflows run without a model API. Assistant help is currently used to inspect unsupported layouts, repair mappings, and resolve unexpected results. It is not evidence of unattended reliability across all 286 sites.
