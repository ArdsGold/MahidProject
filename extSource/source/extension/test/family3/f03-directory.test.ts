import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { getSiteAdapter } from "../../src/automation/adapters";
import { f03Directories, getF03Directory } from "../../src/automation/f03-directory";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";

const sample: BusinessProfile = { ...createEmptyProfileInput(), id: "sample", businessName: "Example Test Business", website: "https://example.test/business", contactName: "Example Owner", email: "owner@example.test", description: "Safe approved sample description. Never submit.", category: "", createdAt: "2026-10-18", updatedAt: "2026-10-18" };
function setup(t: TestContext, url: string, html: string) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("F03 fill-only cannot access runs, receipts, authorization or Sheets"); } });
  const doc = win.document as unknown as Document; let actions = 0;
  doc.addEventListener("click", () => actions++); doc.addEventListener("submit", e => { actions++; e.preventDefault(); });
  for (const form of win.document.forms) for (const method of ["submit", "requestSubmit"]) Object.defineProperty(form, method, { value: () => actions++ });
  t.after(async () => { assert.equal(actions, 0); await win.happyDOM.close(); });
  return { doc, value: (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value };
}

for (const { site, adapter, inspect } of f03Directories) {
  const fixture = readFileSync(new URL(`../../family3/fixtures/${site.domain}.html`, import.meta.url), "utf8");
  const target = site.startingUrl + "submit.php";
  const category = ["ad-links.org", "backpagedir.com"].includes(site.domain) ? "Cleaning" : "Web Design and Development";
  const profile = { ...sample, category };

  test(`${site.domain}: exact observed Add Site routing, no cross-site or ambiguous entry`, t => {
    setup(t, site.startingUrl, '<a href="/submit.php">Add Site</a><a href="/submit.php">Add Site</a>');
    assert.equal(getSiteAdapter(location.href)?.config.id, site.id);
    const report = runListingAutofill(profile);
    assert.deepEqual(report.entryAction, { label: "Add Site", href: target }); assert.equal(report.filled.length, 0);
    for (const href of ["https://directory3.org/submit.php", `http://${site.domain}/submit.php`, `https://${site.domain}.evil.test/submit.php`, `https://user:pass@${site.domain}/submit.php`]) assert.equal(adapter.discoverEntry("", [{ text: "Add Site", href }]), null);
    assert.equal(adapter.discoverEntry("", [{ text: "Add Site", href: target }, { text: "Add Site", href: target + "?c=1" }]), null);
    assert.equal(adapter.discoverEntry("", [{ text: "Submit Link", href: target }]), null);
  });

  test(`${site.domain}: actual six fields/current options fill, Terms/CAPTCHA/search/reciprocal untouched`, t => {
    const { doc, value } = setup(t, target, fixture);
    assert.equal(inspect(doc, location.href).state, "form");
    const form = doc.querySelector('[name=TITLE]')!.closest('form')!;
    form.insertAdjacentHTML("beforeend", '<input type="checkbox" name="terms" aria-label="Accept Terms"><textarea name="g-recaptcha-response">human-token-unchanged</textarea>');
    doc.body.insertAdjacentHTML("beforeend", '<input name="q" value="Search"><input name="RECPR_URL" value="unchanged"><textarea name="RECPR_TEXT">unchanged</textarea>');
    const select = doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!;
    assert.equal(select.options.length, site.domain === "addgoodsites.com" ? 541 : site.domain === "businessfreedirectory.biz" ? 540 : 3500);
    const chosen = [...select.options].find(o => o.textContent?.trim().endsWith("___" + category))!;
    chosen.value = "current-site-option-not-84";
    const report = runListingAutofill(profile); assert.equal(report.filled.length, 6);
    for (const [name, expected] of Object.entries({ TITLE: profile.businessName, URL: profile.website, DESCRIPTION: profile.description, OWNER_NAME: profile.contactName, OWNER_EMAIL: profile.email })) assert.equal(value(name), expected);
    assert.equal(value("CATEGORY_ID"), chosen.value); assert.equal(value("q"), "Search");
    assert.equal(value("RECPR_URL"), "unchanged"); assert.equal(value("RECPR_TEXT"), "unchanged"); assert.equal(value("g-recaptcha-response"), "human-token-unchanged");
    assert.equal(doc.querySelector<HTMLInputElement>('[name=terms]')!.checked, false);
    assert.equal(report.liveUrl, undefined); assert.equal(report.form, undefined);
  });

  test(`${site.domain}: unrelated category remains manual; distinctive services reuse current matcher`, t => {
    const { value } = setup(t, target, fixture);
    const unrelated = runListingAutofill({ ...profile, category: "zzzzzz", services: [], businessName: category, description: category });
    assert.equal(value("CATEGORY_ID"), "0"); assert(!unrelated.filled.some(f => f.field === "category"));
    const service = runListingAutofill({ ...profile, category: "", services: [category] });
    assert.notEqual(value("CATEGORY_ID"), "84");
    const matched = service.filled.find(f => f.field === "category");
    if (matched) assert.match(matched.value, new RegExp(category));
    else { assert.equal(value("CATEGORY_ID"), "0"); assert(service.manual.some(m => /matching option: CATEGORY_ID/.test(m))); }
  });

  test(`${site.domain}: required data validation, changed controls/action and Continue fail closed`, t => {
    const { doc, value } = setup(t, target, fixture);
    const bad = runListingAutofill({ ...profile, businessName: "", website: "not-a-url", email: "invalid", contactName: "x".repeat(256) });
    for (const name of ["TITLE", "URL", "OWNER_EMAIL", "OWNER_NAME"]) assert.equal(value(name), "");
    assert(bad.skipped.length >= 4);
    const form = doc.querySelector('[name=TITLE]')!.closest('form')!;
    const submit = form.querySelector<HTMLInputElement>('[name=submit]')!;
    submit.value = "Submit"; assert.equal(runListingAutofill(profile).filled.length, 0); submit.value = "Continue";
    form.insertAdjacentHTML("beforeend", '<input type="file" name="unverified-upload">');
    assert.equal(runListingAutofill(profile).filled.length, 0); form.querySelector('[name=unverified-upload]')!.remove();
    form.action = "https://directory3.org/submit.php"; assert.equal(runListingAutofill(profile).filled.length, 0);
  });

  test(`${site.domain}: unsupported HTTP fails closed rather than generic autofill`, t => {
    setup(t, target.replace("https:", "http:"), fixture);
    assert.equal(getSiteAdapter(location.href), null); assert.equal(runListingAutofill(profile).filled.length, 0);
  });

  test(`${site.domain}: async uses same native mapper without storage/location cascade`, async t => {
    setup(t, target, fixture); assert.equal((await runListingAutofillAsync(profile)).filled.length, 6);
  });
}

test("F03 routing has only four verified exact domains; no suffix/group wildcard", () => {
  assert.equal(f03Directories.length, 4);
  for (const url of ["https://evilad-links.org/", "https://ad-links.org.evil.test/", "https://example.test/", "https://jet-links.com/"]) assert.equal(getF03Directory(url), null);
});
