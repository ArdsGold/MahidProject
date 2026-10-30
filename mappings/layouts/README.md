# Per-website layout inventory

This folder contains one JSON inventory file for each website in `websites/Website_Pool.xlsx`, plus `index.csv` and `progress.json`. Initial records marked **Not inspected** are queue placeholders, not completed mappings. Existing runtime mappings remain in the registry and family-specific files.

Run the layout-mapping queue from the project root:

```powershell
python map_websites.py --browser
```

It uses the existing Ui.Vision connection in regular Chrome. Keep the panel open. The queue visits publishing entry routes and follows up to eight relevant same-host navigation steps per website. It does not publish business content. The operator subsequently authorized automatic sign-in and free account creation using the shared workbook credentials on all sites. `site_access.py` implements inspected login/registration contracts, excludes marketing opt-ins on the known blog form, and refuses missing required facts, payment controls or changed origins/actions. Unsupported account forms remain mapping gaps rather than prompting for routine sign-in status. CAPTCHA and email verification go to the operator. Enter resumes inspection of the current page without reloading; `skip` defers the access check, and `stop` pauses the queue. Google identity verification is skipped and Medium stays deferred. Never select a saved personal Google account.

The default private account source is `.local/workbooks/Cheer_Athletics_St_Louis.xlsx`; use `--workbook path.xlsx` to change it. The loader requires one unambiguous supplied account and does not print credentials. Account-creation state is saved before submission in `.local/site-access/<domain>.json`; uncertain registrations are protected against blind repetition. These checkpoints contain outcomes, not passwords. Transfer them privately with the workbook. Listing/publication journals and confidence scores remain untouched by account access.

When CAPTCHA or email verification requires operator action, the tool sends one Windows desktop notification with sound. The terminal and browser remain waiting; there are no repeated reminders for the same prompt. Notification delivery was confirmed on the source computer. Use `python operator_notifications.py --test` on a transferred Windows installation. Alerts contain the prompt only, never the shared credentials.

The shared blog layout also uses a custom `#captcha_window` / `.captcha_checkbox` widget. The runner fills account fields and waits for the operator when it is visible. It never clicks or solves the CAPTCHA. Because that widget has no reliable success flag, operator confirmation permits one normal form submission; the site still validates the response. Earlier unresolved account submissions remain protected. For an uncertain registration, a later login may recover access without repeating account creation.

If the site reports the account is banned or suspended, inspection is marked **Skipped banned/suspended**. The tool records the reason and does not retry sign-in or create another account on that website.

`python map_websites.py` updates the inventory index and pool columns without browser access. `--only example.com` narrows a browser pass; `--reinspect` revisits saved outcomes. Disabled pool rows are retained in the index but not navigated. Previously confirmed layouts and saved inspection errors are skipped on resume; legacy inspections without button confirmation are revisited; unresolved access checkpoints are retried. Use `--reinspect --only example.com` for deliberate error rechecks. No campaign journal or confidence attempts are reset or created by mapping.

| Data | Meaning |
| --- | --- |
| `pages` | Observed routes, form method/action, control identifiers/selectors, visibility, required flags, lengths and category samples |
| `field_map` | Known family controls for public business fields; generic/unmatched controls are not guessed |
| `native_guard` | Directory configuration and read-only live form validation, including failure reasons |
| `runtime` | Whether the hostname already has an implemented publishing route |
| `remaining` | Work still needed to turn the blueprint into an adapter |
| `status` | Inspection progress, independently of publication status |

Field values, passwords, hidden tokens and raw authenticated page bodies are excluded. Entry queries use a small allowlist of navigation parameters. External SSO pages are not stored as the original website's layout. Category samples stop at 40 labels, with a truncation flag; fetch full live choices when implementing the workflow.

**Form blueprint saved** means a known form family was observed. A failed native guard, mandatory reciprocal link, paid plan, unsuitable category, or missing receipt mapping can still prevent use. **Needs deeper inspection** and **Entry points saved; form incomplete** explicitly retain gaps. A finite navigation pass cannot prove every possible workflow has been found. A template or blueprint never enables a new publishing domain automatically.

**Needs review** replaces the overly broad Account access gap label. Its `review_reason` distinguishes unsupported forms, unsupported external sign-in, unidentified registration entry points and unconfirmed account outcomes. `review_evidence` points to observed pages/forms; `verification_level` explicitly says when evidence is automated and access was not independently confirmed. An unsupported adapter does not prove information is missing or the website is inaccessible. The initial 49 relabelled records were not newly verified; original files were backed up in `.local/layout-review-backups/`. Pool columns and the index show the review reason and verification level. Any subsequent assistant review is recorded separately and does not manufacture successful authentication.

Account access is marked signed in only with positive authenticated-navigation evidence, currently a visible same-site sign-out control after the account action. A guest homepage or the disappearance of the password form is insufficient. This still does not establish access to a posting editor; that page must be inspected separately. A site using different authenticated controls remains a review item until its verification mapping is added.

Preserve this folder and `../template_observations.json` for the next operator. Do not run mapping and publishing concurrently in the shared Chrome window.


## Confirmed mapping standard (2026-10-23)

- On EVERY website's first mapping, ask the operator to confirm Register and Post/Add Listing controls, even when detection is confident. Save exact labels, selectors or safe URLs, originating pages and navigation steps in `mappings/layouts/<domain>.json`. Existing inventories without confirmation remain provisional and are revisited on resume; explicit deferrals, bans, identity skips and inspection errors are preserved.
- Inspect posting routes after sign-in, including when the account adapter is unsupported or the authentication result is uncertain. A login problem does not prove that an observed Add Listing route is unusable. Buttons without safe navigation URLs are recorded for operator inspection, never blindly clicked as navigation.
- Strongest completion evidence is a public backlink independently verified under campaign rules. The mapping-only fallback is a validated final posting form, labelled **Final posting form reached; publication untested**. Template recognition, login, homepage access and saved entry points alone do not complete a mapping. No new publication is authorized by this status; publishing remains paused during the mapping pass.
- Mark **Access gap** only after rechecking registration, login AND posting routes, recording explicit blocking evidence, and asking the operator to confirm no usable route remains. Unsupported automation stays Needs mapping/review. Do not fabricate route outcomes or infer absence from a short navigation scan.
- First-mapping button confirmation and Access-gap confirmation are required operator questions in addition to CAPTCHA/email checks. Use the existing one-time Windows notification with sound for these waits.
