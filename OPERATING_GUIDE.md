# Operating the Windows backlink publisher

This guide describes the existing private Windows project. This repository currently distributes documentation, not a complete runnable installation. Obtain the full private project from its trusted owner; cloning this repository alone does not include the runner, workbook, website pool, credentials, or campaign history.

## Prepare a client workbook

1. Copy `templates/Backlink_Template.xlsx` from the full project. Save a separate copy per client, for example `.local/workbooks/Your_Client.xlsx`.
2. Keep the sheet names `Business`, `Hours`, `Sites`, and `Instructions`, and preserve their field labels and column headers. Fill the blue cells with approved data; paste values rather than formulas.
3. In Business, enter the official name, exact destination website URL, approved description, address, phone, public email, category, keywords, and available public social links. Name, Website, and Description are required; individual sites may require more.
4. In Hours, use one weekday per row. Put `Open` in Status and separate 24-hour values such as `15:00` and `21:00` in Opens and Closes. For Closed, 24 hours, or By appointment, leave the time cells empty. Blank status means unknown. Do not paste a combined range such as `3-9 PM` into a time cell.
5. In Sites, enter the listing hostname and supplied account credentials, plus Enabled = Yes/No. Credentials remain private; they are never public listing content.

`templates/Cheer_Athletics_Example.xlsx` is a public-data example with no login credentials. For the existing campaign, continue using `.local/workbooks/Cheer_Athletics_St_Louis.xlsx` and preserve its campaign identity and output folder.

The expandable website pool is `websites/Website_Pool.xlsx`, sheet Websites. Edit Website, Enabled, and Notes. Set Enabled to No to exclude a site, and explain why in Notes. Adding a URL does not create a publishing workflow. Close Excel before running the tool so reports and pool labels can update.

## Set up the full private project

Use Python 3.10 or newer, Node.js/npm, and regular Google Chrome with Ui.Vision installed. Run these commands from the full project folder on a new machine:

```powershell
python -m pip install -r requirements.txt
python -m playwright install chromium
npm install --prefix .local/uivision-bridge --no-audit --no-fund --ignore-scripts uivision-mcp-bridge@1.7.20
```

These commands require the project source files from the private transfer. Chrome sessions, extensions, Python environments, and running bridge processes do not transfer automatically between computers.

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

Only run one publisher per campaign. The current supervised workflow uses Ui.Vision in regular Chrome; the separate Windows GUI is deferred in the operator's current workflow. The launcher executes registered adapters. Additional supervised blog helpers and new or changed mappings still require a maintainer; the launcher is not a universal publisher for every pool row.

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

Keep credentials, client workbooks, raw authenticated diagnostics, edit tokens, and campaign output private. Preserve the entire `.local/` and `output/` folders during a trusted private handoff. Do not publish them to GitHub. The website pool and template XLSX files are currently excluded by the project's Git ignore rules; obtain them through the private transfer or regenerate templates using the full project's workbook utility.

The saved workflows run without a model API. Assistant help is currently used to inspect unsupported layouts, repair mappings, and resolve unexpected results. It is not evidence of unattended reliability across all 286 sites.
