# Website mappings

Template detection is implemented in `../template_detector.py`. Structural observations in `template_observations.json` label pool families and variants without adding hosts to `registry.py`. Both publishers collect rendered form structure during preparation, excluding values and hidden tokens. The read-only CLI can scan new pool sites; see [usage and evidence rules](../websites/README.md#template-detection). Family matches are mapping leads, not validated free publishing routes.

Reusable mapping code and the workflows learned during the interactive sessions live here. The root scripts remain the app's entry points; use the same commands as before.

For another operator, read [HANDOFF.md](../HANDOFF.md) and [AGENTS.md](../AGENTS.md). The active, user-expanded queue is `websites/Website_Pool.xlsx` (286 unique websites at handoff). `sites.csv` remains the original 95-domain reference index; neither it nor the 100-row extSource index replaces that pool. Transfer the campaign journal, attempt history and private recovery access as well as this mapping folder.

| File | Purpose |
| --- | --- |
| [sites.csv](sites.csv) | Index of all 95 distinct workbook domains, with mapping type, source and limitations |
| [registry.py](registry.py) | Domain groups: 48 directories, 27 classifieds, and eight individual platforms |
| [telegraph.py](telegraph.py) | Official Telegraph API payload and request mapping; live access unverified |
| [imported_directories.json](imported_directories.json) | 28 directory configurations adapted from extSource, with source paths and hashes |
| [directories.py](directories.py) | Combines imported configurations with the live Lemon contract and resolves submission URLs |
| [native_directory.js](native_directory.js) | Shared native-form checks used by Playwright and Ui.Vision |
| [external_sites.csv](external_sites.csv) | All 100 named extSource sites, with integrated versus reference-only status |
| [playwright.py](playwright.py) | Playwright navigation, field selectors, category selection and final submission selectors |
| [uivision.js](uivision.js) | Regular-browser workflows for the directory and classifieds families |
| [pastelink.py](pastelink.py) | Pastelink fill and capture macro commands used by the helper exporter |
| [common.py](common.py) | Shared content formatting, navigation, editor and CAPTCHA helpers |
| [content_fit.js](content_fit.js) | Shared public-content fitting and omission reporting for both browser runners |
| [category_match.js](category_match.js) | Shared exact/semantic category matching against enabled live options |
| [editors.py](editors.py) / [rich_editor.js](rich_editor.js) | Approved paragraph formatting and explicit TinyMCE/CKEditor synchronization |
| [interactive-workflows.md](interactive-workflows.md) | Saved steps and limitations from sites inspected interactively |

The registry covers 83 domains with reusable code. That is mapping coverage, not a promise that every site accepts submissions or has a verified publication. The classifieds mapping currently requires a US address and an appropriate sports/fitness category. The Ui.Vision runner uses Chrome for the 75 directory/classifieds domains and delegates the other eight routes to Playwright or the official API. A separate Pastelink helper pilot remains available. The shared [website pool](../websites/README.md) supplies an expandable queue, confidence scores and a target of 100 verified distinct websites.

The extSource import contributes 28 directory configurations: 13 overlap with our original mappings and 15 add new domains. None of those 15 additions appears in the current 95-domain workbook, so that workbook now has 51 domains with reusable code after adding WriteABlog. The original workbook index remains `sites.csv`; `external_sites.csv` is a separate source-coverage index.

Imported directory configurations supply the submission origin/protocol, native field contract, final button label and free listing/Terms variations. Both runners check the live form before filling. The Ui.Vision runner checks it again before its journaled final click. The existing category choices, reciprocal-link refusal, CAPTCHA handling and public verification still apply. Source comments about earlier users' approvals are not imported as authorization. The source extension's manual-only final-click policy is not an executable dependency of our separate publishing runner.

The 50 blog-family and 21 business-listing-family names are retained as reference-only entries, not enabled as complete publishing adapters. FreeWebAds was already supported by our classifieds workflow. Runtime use needs only this project's mapping files; extSource remains unchanged. Its saved fixtures are used for offline regression tests, not as evidence that live pages still match.

Additional extSource reuse keeps the same XLSX, commands and result files. Both browser runners use one category matcher: prefer exact labels and the general Sports category, then rank live choices using approved category/services/descriptions. Duplicate labels prefer a uniquely shallower tree category; ties, disabled choices and unrelated restrictive categories remain unmapped. Classifieds still use their existing sports/fitness-only route.

The JustPaste.it mapping now uses an explicit editor helper that retains approved paragraphs and the official website anchor, synchronizes the backing field, and checks the saved content. TinyMCE and CKEditor API support is fixture-tested; this does not enable additional blog domains automatically. HTML-like text in the XLSX description stays literal text.

Ui.Vision resume checks saved candidate URLs with the existing independent public verifier before considering new work. A failed check preserves the candidate and prior attempt metadata; recovery never invokes the submission macro. Published and uncertain attempts without candidates retain the existing skip behavior. CAPTCHA prompts, journal-before-click protection and output paths remain the same.

The remaining domains have interactive recipes, inspection notes, or an explicit unmapped/deferred entry in the CSV. An interactive recipe is documentation, not an executable adapter.

Campaign-specific statuses, public URLs, generated macros and CSV inputs remain under `output/<campaign>/`. The authoritative status is `state.json`; the requested published-link list is `published_urls.txt`. Private diagnostics remain under `.local/`, and login credentials remain in the input workbook. This folder contains no account credentials or private edit links.

To extend a workflow, edit `playwright.py` and `registry.py`, or `uivision.js` for the regular-browser families. Imported site settings live in `imported_directories.json`. Keep final-click journaling and public-link verification in the root runners. Run `python -m unittest test_backlinks test_uivision test_imported_mappings test_reused_features` from the project root; these tests do not publish anything.

WriteABlog was mapped during the resumed run: username/password login, existing public blog selection, approved Markdown and `#publish`, sharing the tested Postheaven editor flow. A nonempty draft stops preparation. Its new public article passed independent verification.

Long description/body fields now combine every available public profile field using an explicit allowlist. Priority is business name, complete website, address, phone, public email, description, short description, category, services, hours/timezone, social links, logo URL and keywords. Dedicated title, URL and contact controls keep their own values. Both runners use `content_fit.js` with the live field's declared `maxlength`, counted in UTF-16 units. Only the description may be shortened; other values are included whole or reported as omitted. If the complete name and website cannot fit, preparation stops. Server-only limits require a site-specific mapping when discovered; the tool does not guess them. Rich editors whose HTML exceeds a declared backing-field limit stop for mapping rather than silently losing content.

The results CSV appends `omitted_fields` and `content_notes`; new attempts retain these through submission journaling, verification and saved-candidate recovery. Existing publications are not rewritten or retrospectively assessed. Empty metadata on an older result does not prove every field was included. Legacy hours normalize en dashes, em dashes or a replacement character between digits to the user-confirmed hyphen; other damaged source text is omitted and reported. Run `python -m unittest test_backlinks test_uivision test_imported_mappings test_reused_features test_content` for the offline checks.

The resumed directory pass confirmed optional blank reciprocal fields on Aurora, Unique Listing, Expansion Directory, Fruity Directory and Relevant Directory.biz. Their configurations opt into native required-marker/value checks; other reciprocal forms remain blocked until inspected. Category matching now considers the shallower Recreation & Sports group when duplicate nested Sports labels are ambiguous. Aurora, Unique and Expansion rejected the destination because the hostname already exists; searches found Omaha entries, which do not qualify for the St. Louis campaign.

Lemon Directory now has its own live-inspected native contract in directories.py (in addition to the 28 extSource imports); it does not add another domain to the registry. Relevant Directories and Relevant Directory.biz prefer their verified HTTPS forms. Optional reciprocal checks support both classed labels and older plain table-cell labels while still refusing required, nonblank or unrecognizable controls.

Telegraph adds one new domain via its [official API](https://telegra.ph/api). The publisher keeps its token in private recovery storage, journals before creating a page and checks the public result independently. Content-limit omissions are reported. Offline payload/interruption checks pass; local DNS access failed during setup, so no live publication is claimed. Mirrors are not counted as separate websites.

Live inspection on 2026-10-23 added Prolink Directory, Popular Directory.org and Directory Direct using the existing native form guard and both publishers. Their configurations are in `directories.py:LIVE_DIRECTORIES`, their index is `live_sites.csv`, and sanitized unauthenticated form fixtures are in `fixtures/`. `test_live_mappings.py` checks approved-field filling and rejection of changed submit/action controls without live submissions. HomeDirectory.biz was inspected but not enabled: its reciprocal field is marked required and no usable category was present. FamilyDir and Jet-links duplicate searches returned a programs page and an Omaha listing respectively; neither matches the approved St. Louis destination.

The directory recovery helper in `discovery.py` now searches `/index.php?q=<business name>` in a fresh context after submission receipts or duplicate rejections, and when resuming protected pending/rejected/uncertain directory records. It matches the exact official destination and the same result row's numeric listing ID, returns only same-domain linked detail pages, journals candidates before verification and never reposts. Both publishers use it. Sites with different search markup, CAPTCHA, certificate problems or unavailable public search still require inspection. Offline tests cover wrong-location exclusion, private/external link refusal, detail ID association and journal-before-verification.

Seven further live-inspected optional-reciprocal forms were added in the same resumed pass: Black and Blue Directory, Black Green Directory, Blue Sparkle Directory, Brown Edge Directory, Alive 2 Directory, Arctic Directory and Azure Directory. Native guards require the reciprocal field to stay blank and optional, and stop if it becomes required. Their live index/configurations and sanitized fixtures are saved alongside the first three additions; no publication is inferred from a form check. PropellerDir was not enabled because its location-URL/content requirements are incompatible with this campaign.

## Category choices

`category_options/<hostname>.json` retains the complete observed dropdown options by fingerprint, plus each topic's automatic or reviewed selection and reason. `category_rules.json` stores assistant-approved choices keyed by hostname and business category/fallback profile. Only actual enabled options may be chosen; the runtime validates both label and value. The queue stops before submitting an ambiguous category, allowing supervised AI review and a saved rule without an AI API dependency. Old snapshots and later changed dropdowns remain distinct.
