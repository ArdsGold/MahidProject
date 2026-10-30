# Shared website pool

## Template detection

`Website_Pool.xlsx` includes calculated template columns and a **Template Groups** summary sheet. Your Website, Enabled and Notes columns are preserved. A backup from before this change is in `websites/backups/`.

| Column | Meaning |
| --- | --- |
| Website type / Template family | PHP directory, XZero-style classifieds, reference blog/business family, individual platform or unknown |
| Structure group / fingerprint | Identical form controls share a fingerprint; differing limits, required fields and controls create variants |
| Template match % | A strict known-family structural match, separate from the publishing success/error confidence score |
| Template evidence | Live browser, live HTTP, saved form, configured route, source reference only, or not inspected |
| Detection status | Match, unmatched form, no form, challenge/network error or mapping/template mismatch |
| Template automation | Whether this hostname already has a mapped route; detection alone never enables one |
| Structure checked UTC / source / notes | When and where the structural evidence was obtained, including saved fixture provenance |

**Single observed structure** means only one website in this pool currently has that fingerprint. It does not prove the website has a unique template. **Unmatched form** can be a login or search form; it requires inspection. JavaScript rendering, sign-in and browser challenges can prevent an HTTP scan from seeing the publishing form. Configured/reference families remain labelled as such when current structure is unavailable; an outage does not erase an earlier fingerprint. Detection errors do not change campaign results or publishing confidence.

Close Excel, then run:

```powershell
python template_detector.py
python template_detector.py --scan
python template_detector.py --scan --only alivelink.org trafficdirectory.org
```

The first command seeds saved form evidence and refreshes the pool without network access. `--scan` makes public HTTP GET requests for enabled websites, using known directory origins, directory submission routes, classifieds entry routes or the supplied pool URL. It never signs in, submits, solves CAPTCHA or navigates regular Chrome. It checks one route per website, so **No form observed** does not establish that the site has no publishing workflow. Disabled rows keep existing/reference classification without live probing.

Observations are stored in `mappings/template_observations.json`. Only structural control identifiers, types, limits, required flags, fingerprints and provenance are retained; field values, descriptions, account credentials and hidden tokens are excluded. Both publishers collect the same structural evidence from rendered forms during preparation; subsequent pool refreshes display it. Keep one detector/publisher writer running at a time.

Use detected families to prioritize mapping work: inspect one real free form, reuse the family workflow, save a per-host configuration and fixture, then run offline checks. Existing origin, field, category, price and final-click guards still apply at publication time. A 100% family match does not establish a free plan, a valid category, a working submission, or a verified backlink.

For a transfer to another operator/computer, follow [HANDOFF.md](../HANDOFF.md). The live list is **Website_Pool.xlsx**; prior deduplicated copies and `backups/` are cleanup artifacts, not additional runtime lists.

Open **Website_Pool.xlsx** and add rows to **Websites**. Edit **Website**, **Enabled** and **Notes**. Use one website per row; full public URLs or hostnames work. The number of rows is independent of the campaign target. Credentials and client details stay in the business workbook.

Both launchers now use this list by default. The business workbook's Sites sheet supplies credentials for matching domains; its `Enabled=No` exclusions still apply. Other enabled pool sites get empty credentials. Adding a URL does not automatically create a working adapter. The Workflow column distinguishes mapped Chrome/Playwright/API routes from **Needs mapping**.

The target is **100 verified backlinks on distinct domains**, including existing matching links. The current campaign starts with 36, so it needs 64 more. A new business starts from its own journal. Both runners stop before the next website once the target is met, continue after errors, preserve pending/uncertain receipts, and report any shortfall when the available workflows are exhausted. Failed and unsupported sites remain `error` in the results CSV. No result or success is invented to fill the target.

Confidence is `100 × (successes + 1) / (successes + errors + 2)`. One success scores 66.7; one error scores 33.3. Untested sites display **Unrated**, with a neutral 50 for ordering. Evidence is Low below 5 scored outcomes, Medium at 5–19, and High at 20 or more. This measures observed publishing reliability, not search ranking value.

Only independently verified public pages are successes. Recovered matching links count toward the target but appear separately from publishing successes. Failed, rejected, unverified and uncertain attempts count as errors. User skips, missing credentials, human verification waits and pending submissions are unscored. Historical needs-attention records are also unscored because they include unattempted and deferred sites. Older records provide **one historical observation per campaign/domain**, not a complete retry log. Each new attempt is recorded once in `output/<campaign>/attempts.sqlite3`; saves and later receipt checks update that same observation. Scores combine histories across businesses in this project.

Close the XLSX while refreshing its calculated columns:

```powershell
python website_pool.py --refresh
```

Refresh preserves the editable columns and includes rows added below the current filter. It rejects duplicate hostnames, formulas in input cells, invalid URLs and invalid Enabled values. Campaign status shows the latest campaign by default; use `--campaign-folder output/<folder>` to choose one.

Preview the ranked queue without opening a browser or posting:

```powershell
python uivision_publish.py "business.xlsx"
```

Run with the existing Ui.Vision connection and CAPTCHA prompts:

```powershell
.\Start_Browser_Automation.ps1 -Workbook "business.xlsx"
```

Use `--pool another-list.xlsx` for another pool, `--target 100` to set the distinct-domain total, or `--workbook-sites-only` for the old workbook-only queue. The same options are available in both Python publishers and the CSV helper. Progress is saved in `progress.json`; verified URLs remain in `published_urls.txt`.

At the 2026-10-23 handoff, the deduplicated pool contains **286 unique domains**: 67 mapped routes (including the new Telegraph API adapter) and 219 needing mappings. The user added 105 distinct websites beyond the initial 181-site pool; 49 repeated rows were removed while preserving all unique sites. For Cheer Athletics, 31 mapped domains already have verified links. The 36 current links plus 36 remaining mapped domains give a theoretical maximum of 72; at least 28 additional working mappings are needed to reach 100, even if every current route succeeds. `progress.json` records this capacity gap after the next preview/run. Reference-only names from extSource and new user-added URLs are leads, not confirmed free or usable services. Imported directory routes still validate the live free-form contract. Further free workflows can be added as sites are inspected.

Telegraph was added using its [official API documentation](https://telegra.ph/api). The adapter includes public client fields, retains complete website links, reports any 64 KB content-limit omissions, stores its account token only in `.local/`, journals before `createPage`, and independently verifies the returned public page. Offline checks cover content and interrupted submissions. Live DNS access failed from this machine during setup, so no live success or published link is claimed. Telegraph mirror domains are not added as separate backlink sites.

Offline checks:

```powershell
python -m unittest test_backlinks test_uivision test_imported_mappings test_reused_features test_content test_workbook_layout test_website_pool test_live_mappings
```

After that handoff snapshot, live form inspection added three routes (Prolink Directory, Popular Directory.org and Directory Direct), bringing coded coverage to 70 of 286 sites; 216 still need mappings. See `mappings/live_sites.csv` and the current journal for actual publication outcomes.
