# Backlink Publisher for Windows

Double-click **Start_Backlink_App.cmd** in the project folder. It opens a native desktop window. No AI account, model API key or coding assistant is required.

The app uses this project's installed Python runtime. It is not a self-contained EXE installer. Python with Tk, the packages in `requirements.txt`, Playwright Chromium, Node, Chrome, Ui.Vision and the pinned local bridge must be installed; see [HANDOFF.md](HANDOFF.md) for setup. No new GUI package is needed.

## Use it

1. Choose the client's completed XLSX. The website pool defaults to `websites/Website_Pool.xlsx` and can also be selected. The app validates the data and opens the correct saved campaign from the business name and website. Loading a workbook does not publish or reset progress.
2. Open regular Chrome with Ui.Vision's MCP bridge enabled. Click **Connect Chrome**. Keep its panel open. The bridge runs commands directly; its location under Ui.Vision's AI settings does not require an AI provider.
3. Click **Start / Resume** to publish with the saved workflows. It processes the full enabled pool, including after 100 verified results. Unsupported sites are marked **Needs mapping** and skipped. A changed workflow cannot be repaired by guessing; it must be maintained separately.
4. When an action panel appears, complete CAPTCHA/email verification directly in the browser and click **Done / Continue**. Leave final submission to the app. Supported individual-platform workflows can open their own visible Chromium window for interaction; directories/classifieds use regular Chrome.
5. For unresolved submissions, the tool performs read-only inspection first. **Done** rechecks without reposting. **Verify URL** independently checks a public listing URL you provide. **Skip this site** defers the result while preserving its uncertain/submitting journal state; it will not be posted again or silently counted.
6. Click **Pause** to stop at the next safe checkpoint. If a browser command is already running, the app waits for it to return and preserves the journal. Closing the window while working requests this same safe pause and closes when the worker finishes. Chrome stays open.
7. Click **Export results** for an XLSX with **Results** and **Verified Links** sheets, or select CSV. Errors, skips and pending results remain in Results. Only independently verified public URLs enter Verified Links. Private credentials, edit links, recovery files and account checkpoints are not exported.

## What is ready

The desktop UI runs the existing deterministic publishing engine; it does not make every saved layout into a working adapter. At this implementation checkpoint the shared pool has 286 sites and 118 coded routes. Actual live access, plan availability and new-client compatibility can vary. Unsupported/changed workflows need maintenance outside the publishing run. Reaching 100 is a target, not a guarantee that 100 sites will accept a free listing.

The current Cheer Athletics campaign remains at 64 verified websites. New clients use separate campaign folders; selecting another workbook does not copy Cheer Athletics' results into it. Existing campaign states and attempt histories remain authoritative.

## Files and recovery

- Runtime UI: `backlink_app.py`; private worker: `desktop_runner.py`.
- Each campaign's `output/<campaign>/` contains its journal, reports and history. Open it with **Open results folder**.
- Private worker diagnostics live under `.local/desktop/`; they are not shown as public results or exported.
- There is one active `results.csv`. If Excel locks it, the publisher asks you to close it and retries the same filename; stopping preserves progress and creates no alternate CSV. Former fallback copies are archived privately as ZIP backups.
- Do not delete journals, locks or private account checkpoints to force another attempt. A lock from another publisher prevents concurrent work on the same campaign.

Offline checks include `python -m unittest test_desktop_app test_operator_notifications` and the existing publisher/mapping suites. These tests do not post live backlinks.
