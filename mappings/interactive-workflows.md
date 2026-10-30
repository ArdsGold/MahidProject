# Interactive workflow notes

These are recipes and observed limitations from the completed inspections, preserved on 2026-10-23. They are not additional executable adapters. Site behavior can change; use the campaign journal before retrying any submission. No credentials, CAPTCHA answers or private edit links are stored here.

## Shared mapping rules

- Use the approved workbook description, business name, website and contact details. Do not infer missing business hours.
- For Google sign-in, choose **Use another account** and the workbook account. Skip the site when Google requests **Verify it's you**, per the user's preference.
- CAPTCHA and identity challenges require the user in the regular browser. An inspection or successful login does not establish a published backlink.
- Record the attempt before the final submission click. Recover an existing candidate instead of repeating a possibly accepted submission.
- Count a public result only after checking the business name and a visible clickable link to the approved website. Plain URL text and preview pages do not qualify. Record expiration, `nofollow` and `noindex` where present.

## Bookmark sites: letsdobookmark.com and abookmarking.com

1. Open `/submit`; if redirected to login, fill `#username` and `#password` from the workbook and submit the login form. Return to `/submit` after authentication.
2. Fill `#checkUrl` with the approved website. Click the Continue control `input[name=submit][type=button]`; wait for `#articleTitle`.
3. Fill `#articleTitle` with the business name, `#tag` with the approved category and `#description` with the approved description. For the inspected business, `#category` used Health & Fitness, value `fDTGa4a6iofH`.
4. Choose Save changes and submit to open the preview. Journal the attempt, then click `#submit` (Submit Story).
5. Recover the `/story/` link from the result or `/home`, then verify it. ABookmarking needed regular-browser verification because a fresh browser request returned 403.

## HelpSellMyFSBO

1. Open `/login`; email is `#member_login_190-element-9`, password `#member_login_190-element-10`, submit `#member_login_190-element-13`. The user completes CAPTCHA.
2. From `/account/blog/view`, choose New Blog Article (`/account/blog/add`). The inspected account offered this article flow without a fee.
3. Set `[name=post_status][value="1"]` (Publish Yes), `[name=post_title]` to the business name, `[name=post_featured][value="0"]` (No) and `[name=post_tags]` to the category. Leave optional placeholder categories and images blank.
4. The inspected editor exposed one `FroalaEditor.INSTANCES` entry. Set escaped approved content with an explicit website anchor; call `events.trigger('contentChanged')` and `events.trigger('blur')`. Check that hidden `[name=post_content]` is synchronized.
5. Journal, then Save Changes using `#blog_article_fields_69-element-24`. Look for Blog Article Saved and recover View Post. Verify the public `/blog/` page.

## PrivateBin

1. Open the editor. Choose Markdown in `#pasteFormatter`, and place the approved Markdown in `#message`.
2. The inspected `#pasteExpiration` maximum was **3 days**. Leave burn after reading and open discussion off, and the password empty. This is a temporary publication.
3. Preview using `#messagepreview`, journal, then create using `#sendbutton`.
4. Use normal browser fill/click/select controls: the site's CSP blocked the classic injected-script method.
5. Preserve the complete public viewer URL: `https://privatebin.net/?<16-hex-id>#<public-decryption-key>`. The fragment is necessary to view the paste. The core public-URL validator supports this format. Verify the rendered link; the inspected result had `nofollow` and `noindex`.

## Expatriates

1. Start `/scripts/posting/poststep1.epl`; login uses `#username`, `#password` and a submit input.
2. Choose I am offering a service, training category `232`, USA region `34`, and the approved street/city/state/ZIP for the new region.
3. Fill `#title`, `#contact_number` and `#description` with approved plain content. Select `[name=whatsapp][value="0"]` for phone only and `[name=hide_email][value="1"]` to hide the account email. The public business email may remain in the approved description.
4. Journal before `#submit` (Publish). Follow the email activation flow interactively.
5. The inspected candidate still displayed PREVIEW after reported activation. Keep it pending until the public page is actually verified; do not repeat the submission just because activation was reported.

## Sites inspected without a qualifying free publication

| Domain | Observed flow or limitation |
| --- | --- |
| mapfling.com | Guest map: `#geocode_search_text` / `#geocode_go`, select the exact-address result `#geocode_a0`, then approved text in `#marker_list_textarea0` and Go Step 3. The saved free map did not render a clickable website link; additional linking required PRO. Do not count the map as a backlink. |
| paste2.org | `#code` takes approved plain text, `#lang` Plain Text, `#description` name and website. Saved public paste showed plain URL text without a clickable link; excluded. |
| localsdaily.com | `/classified/login.aspx` uses `#PageContent_LoginForm1_Email`, `_Password` and `_Login`. Login succeeded. `/classified/listingedit.aspx` offered a free 60-day Trial without website URL; the Basic plan with a website URL cost $3/year at inspection. No qualifying free publication made. |
| cargodirectory.co | `/login` uses `#member_login_190-9`, `#member_login_190-10`, `#member_login_190-13` plus CAPTCHA. Existing free Silver listing was not a new publication. New Community Article, Blog and Classified options showed fees ($97, $25, $97 at inspection). No purchase made. |
| lodgingowners.com | Stated eligibility was lodging owners; this business did not qualify. |
| pininthemap.com | Address/coordinate pins were available, but no business website field. FAQ said additional pin text had been removed. |
| zerobin.net | The inspected terms prohibited bots/automation. No automated submission made. |

## Sign-in and access notes

| Domain or group | Inspection outcome |
| --- | --- |
| medium.com | Magic-link sign-in was initiated; user explicitly deferred Medium. No post. |
| bpa-mastery.mn.co | Email identified a social-sign-in account; Google was selected with Use another account. Password accepted, then Google requested Verify it's you. Skipped per the user's instruction. |
| Other `mn.co` workbook sites, sites.google.com, youtube.com | Google identity check caused this shared-account work to be deferred. These sites were not each independently tested for the same failure. |
| pearltrees.com | Log In reveals `#log_username`, `#log_password`, `#signin-button`; supplied login returned Something went wrong. No confirmed login. |
| ko-fi.com | `/account/login`: `#UserName`, `#Password`, `#formSubmitButton`; supplied credentials rejected. |
| flipboard.com | Email login was ambiguous across accounts; the subsequent supplied username attempt failed. |
| core.seokhazanatools.com | `/login` fields `#username`, `#password`, button Login. Controlled React state was populated, but the app stayed on login; authentication was not confirmed. |
| seobalnd.seokhazanatools.com | Login remained on the login page; authentication was not confirmed. |
| single.goarticles.info | Login returned an invalid username/password error. |
| arch.seokhazanatools.com | Naked-domain `/login` was empty. The `www` variant was not inspected. |
| place123.net, detroitbusinesscenter.com, livejournal.com, flipmyyard.com | Did not load in the regular-browser inspection. This does not establish a permanent outage or cover every hostname variant. |
| freelistingaustralia.com | `/create-listing` led to the `www` login page with password and Google options. No login attempt or US-business eligibility check completed. |

## Still needing a form mapping

`4shared.com`, `pinterest.com`, `cally.com`, `cakeresume.com`, `iformative.com`, `paste.laravel.io`, `filcanonline.com`, and the incomplete FreeListingAustralia inspection have no reusable submission mapping yet.

CakeResume redirected to Cake.me during discovery. Cally would need real event details; iFormative would need appropriate factual review content. The initial discovery request for FilCanOnline encountered a TLS issue, which was not verified in the regular browser. WriteABlog was subsequently inspected through `/login` and mapped to the existing public blog editor in `playwright.py`. These observations do not establish a working adapter.

## Additional resumed inspections (2026-10-23)

WriteABlog now has a reusable, offline-tested mapping in `playwright.py`: `/login`, `#username-input`, `#password-input`, `#btn-login`, existing blog alias selection, Markdown in `#writer`, and one journaled `#publish` click. Nonempty drafts are protected. The new article passed anonymous verification after handling CSS uppercase display of the business name.

4shared: Sign In > Google > Use another account > supplied identifier reached **Verify it is you**. Skipped per user instruction; no content submitted.

- **iformative.com**: Login succeeded. Account profile exposes name/contact/location fields but no website or biography field. Consumer-review posting was not used; no new content submitted.
- **cally.com**: Inspected free workflow creates scheduling events and requires genuine event details/dates. No approved event details or public business-listing flow verified; no event created.
- **pinterest.com**: Supplied public profile handle redirected to Pinterest home with show_error=true. Account not authenticated; Google sign-in deferred after the supplied account requested Verify it is you on 4shared. No content submitted.
- **cakeresume.com**: Domain redirects to Cake.me. The tested /me/ profile handle returned Page not found. Login offers Google; sign-in deferred after the shared account requested Verify it is you on 4shared. No content submitted.
- **freelistingaustralia.com**: Create Listing redirects to login. Site describes an Australian business directory; US-business eligibility not confirmed. Google sign-in deferred after the shared account identity check; no listing submitted.
- **paste.laravel.io**: Inspected form is a code-snippet paste editor. No qualifying business listing or rich-text publishing workflow verified; no submission made.
- **filcanonline.com**: Previous regular-Chrome inspection reached a browser error page. No publishing form or public backlink could be verified; no content submitted.

Aurora Directory and Unique Listing: live forms inspected again on 2026-10-23. Required title/URL/name/email/category fields have a required marker; reciprocal URL has no required marker and no required/aria-required attribute. These two configurations now permit a blank reciprocal field, checked again before submission. No reciprocal link is fabricated or added to the client website. A required/nonblank/changed reciprocal control still stops the workflow.

Expansion Directory: reciprocal URL is optional in the live form; blank allowed only while native required/label/value checks pass. Use Recreation & Sports rather than one of the ambiguous nested Sports entries. Native search uses /gosearch.php?q=... . Unique Listing uses /index.php?q=...; its /gosearch.php route is not the native search endpoint. Native searches on Aurora and Unique returned Omaha entries pointing to /programs/, not the approved St. Louis URL; they are excluded.

Fruity Directory and Relevant Directory.biz: live forms show optional, blank reciprocal fields; configurations now enable the same guarded blank-field path. Relevant Directory.biz uses HTTPS because the HTTP form failed in this pass. Native searches on Fruity, Lemon, Relevant Directory.biz and Relevant Directories returned Omaha entries only, not the approved St. Louis destination.

Expatriates rechecked on 2026-10-23: account My Ads explicitly marks the recent posting Removed; its public URL returns Page Not Found. The older matching ad is Expired. The recent posting is now an error, and is not automatically reposted.

Lemon Directory: live form uses HTTPS POST to /submit.php, native Submit button and ordinary table-cell labels. Its inspected contract is now kept in directories.py alongside the separately tracked extSource imports. Relevant Directories.com similarly uses plain table labels and the working HTTPS form. Both allow a blank optional reciprocal field only while native field/required-marker checks pass; the client website is not edited.

Fruity rejected the supplied destination as a duplicate hostname. Relevant Directory.biz returned no usable public receipt; a fresh native search after the attempt still showed only Omaha. Keep that attempt uncertain and do not resubmit automatically.

Final recovery in this pass: Relevant Directories.com and Relevant Directory.biz returned no usable publication receipt; fresh native searches showed only Omaha. EF Dir search likewise showed Omaha. Related Directory returned a detail candidate with unrelated content and failed exact St. Louis backlink verification; it was excluded. These outcomes remain uncertain/error rather than being automatically reposted. Lemon rejected the supplied website hostname as a duplicate. No new verified URL was added in this pass.
