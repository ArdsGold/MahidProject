import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { directory3Adapter, inspectDirectory3 } from "../../src/automation/directory3";
import { getSiteAdapter } from "../../src/automation/adapters";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";
import { createListingRun, updateListingRun } from "../../src/listing-run";

const fixture = readFileSync(new URL("../../family3/fixtures/directory3.html", import.meta.url), "utf8");
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "approved-fixture-profile", businessName: "Example Test Business", contactName: "Example Test Owner", email: "owner@example.test", website: "https://example.test/business", description: "<p>Approved long description with <a href='https://example.test/'>visible link text</a>.</p>", shortDescription: "Different short text", category: "Web Design", imageUrl: "https://example.test/logo.png", logoAsset: { id: "logo", fileName: "logo.png", mimeType: "image/png", size: 10 }, createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z" };

function setup(t: TestContext, url = "http://directory3.org/submit.php", html = fixture) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("Directory3 must not mutate run/approval/receipt state or send browser commands"); } });
  win.document.write(html);
  let clicks = 0, submissions = 0;
  win.document.addEventListener("click", () => { clicks++; });
  win.document.addEventListener("submit", e => { submissions++; e.preventDefault(); });
  for (const form of win.document.forms) {
    Object.defineProperty(form, "submit", { value: () => { submissions++; } });
    Object.defineProperty(form, "requestSubmit", { value: () => { submissions++; } });
  }
  t.after(async () => { assert.equal(clicks, 0); assert.equal(submissions, 0); await win.happyDOM.close(); });
  const doc = win.document as unknown as Document;
  const value = (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value;
  return { win, doc, value };
}

test("Directory3 native homepage entry reuses navigation report; rejects foreign and ambiguous targets", t => {
  setup(t, "http://directory3.org/", '<form><input name="q"></form><a href="/submit.php">Submit Links</a>');
  const report = runListingAutofill(profile);
  assert.equal(getSiteAdapter(location.href)?.config.id, "directory3");
  assert.equal(report.navigationUrl, "http://directory3.org/submit.php");
  assert.equal(report.entryClick, false);
  assert.deepEqual(report.entryAction, { label: "Submit Links", href: report.navigationUrl });
  assert.equal(report.filled.length, 0);
  for (const href of ["https://directory3.org.evil.test/submit.php", "https://unique-listing.com/submit.php", "http://user:pass@directory3.org/submit.php", "http://directory3.org:3210/submit.php", "http://directory3.org/submit.php?token=x"]) assert.equal(directory3Adapter.discoverEntry("", [{ text: "Submit Links", href }]), null);
  assert.equal(directory3Adapter.discoverEntry("", [{ text: "Submit Links", href: "http://directory3.org/submit.php" }, { text: "Submit Links", href: "http://directory3.org/submit.php?c=33" }]), null);
});

test("approved profile supplies all confirmed selectors; manual CAPTCHA/Terms/Continue and outside fields untouched", t => {
  const { doc, value } = setup(t);
  doc.body.insertAdjacentHTML("beforeend", '<input type="checkbox" name="terms" aria-label="Accept Terms"><input type="file" name="outside_photo" accept="image/*">');
  assert.equal(inspectDirectory3(doc, location.href).state, "form");
  const report = runListingAutofill(profile);
  assert.equal(report.filled.length, 6);
  assert.equal(value("TITLE"), profile.businessName); assert.equal(value("URL"), profile.website);
  assert.equal(value("OWNER_NAME"), profile.contactName); assert.equal(value("OWNER_EMAIL"), profile.email);
  assert(value("DESCRIPTION").includes("visible link text")); assert(!value("DESCRIPTION").includes("<")); assert(!value("DESCRIPTION").includes(profile.imageUrl)); assert(!value("DESCRIPTION").includes(profile.shortDescription));
  const select = doc.querySelector<HTMLSelectElement>('[name="CATEGORY_ID"]')!;
  assert(select.selectedOptions[0].textContent?.endsWith("Web Design")); assert.notEqual(select.value, "33");
  for (const name of ["q", "outside_email", "RECPR_URL", "RECPR_TEXT"]) assert.equal(value(name), "");
  assert.equal(doc.querySelector<HTMLInputElement>('[name="terms"]')!.checked, false);
  assert.equal(doc.querySelector<HTMLInputElement>('[type="file"]')!.files?.length, 0);
  assert.equal(report.form, undefined); assert.equal(report.liveUrl, undefined);
  assert(report.manual.includes("CAPTCHA")); assert(report.manual.includes("Final Submit")); assert(report.manual.includes("Terms/Agreement"));
});

test("category is matched by current label/services, never remembered33 or a fixed option ID", t => {
  const { doc, value } = setup(t);
  const select = doc.querySelector<HTMLSelectElement>('[name="CATEGORY_ID"]')!;
  const web = [...select.options].find(o => o.textContent?.endsWith("Web Design"))!;
  web.value = "changed-current-id";
  const report = runListingAutofill(profile, { profileKey: "web-design", value: "33", label: "Other (Arts)" });
  assert.equal(value("CATEGORY_ID"), "changed-current-id");
  assert(report.filled.some(f => f.field === "category" && f.value.includes("Web Design")));
  assert.equal([...select.options].find(o => o.value === "33")!.textContent?.trim().endsWith("Other (Arts)"), true);
});

test("unrelated/weak categories, ties and disabled matches remain manual", t => {
  const { doc, value } = setup(t);
  const unknown = { ...profile, category: "zzzzzzzzz", services: [], businessName: "Arts Business", description: "Arts and entertainment" };
  const report = runListingAutofill(unknown);
  assert.equal(value("CATEGORY_ID"), "0"); assert(!report.filled.some(f => f.field === "category")); assert(report.manual.some(x => /CATEGORY_ID/.test(x)));
  const select = doc.querySelector<HTMLSelectElement>('[name="CATEGORY_ID"]')!;
  select.innerHTML = '<option value="0">[Top]</option><option value="a">Web Design</option><option value="b">Web Design</option>';
  assert(!runListingAutofill(profile).filled.some(f => f.field === "category"));
  select.innerHTML = '<option value="0">[Top]</option><option value="a" disabled>Web Design</option><option value="33">Other (Arts)</option>';
  assert(!runListingAutofill(profile).filled.some(f => f.field === "category"));
  assert.equal(value("CATEGORY_ID"), "0");
});

test("required business values, URL/email syntax, native lengths and retained values are validated", t => {
  const { doc, value } = setup(t);
  const invalid = { ...profile, businessName: "x".repeat(256), website: "javascript:alert(1)", email: "not-email", contactName: "", firstName: "", lastName: "", description: "", category: "zzzzzzzz" };
  const report = runListingAutofill(invalid);
  for (const name of ["TITLE", "URL", "OWNER_EMAIL", "DESCRIPTION"]) assert.equal(value(name), "");
  assert(report.manual.some(x => /maximum length/.test(x))); assert(report.manual.some(x => /Email is invalid/.test(x))); assert(report.manual.some(x => /DESCRIPTION/.test(x)));
  doc.querySelector('[name="OWNER_EMAIL"]')!.addEventListener("change", () => { doc.querySelector<HTMLInputElement>('[name="TITLE"]')!.value = ""; });
  const retained = runListingAutofill(profile);
  assert(!retained.filled.some(f => f.field === "businessName")); assert(retained.manual.some(x => /value changed/.test(x)));
});

test("changed forms, duplicate fields, upload controls and login/challenge pages fail closed", t => {
  const { doc, win } = setup(t);
  for (const mutate of [
    (form: HTMLFormElement) => form.querySelector('[name="OWNER_EMAIL"]')!.remove(),
    (form: HTMLFormElement) => form.append(form.querySelector('[name="TITLE"]')!.cloneNode(true)),
    (form: HTMLFormElement) => { form.action = "https://evil.test/submit.php"; },
    (form: HTMLFormElement) => form.insertAdjacentHTML("beforeend", '<input type="file" name="new_image">'),
  ]) {
    doc.body.innerHTML = fixture; mutate(doc.querySelector('[name="TITLE"]')!.closest("form")!);
    assert.equal(runListingAutofill(profile).filled.length, 0);
  }
  doc.body.innerHTML = '<form><input name="email"><input type="password" name="password"></form>';
  assert.equal(runListingAutofill(profile).filled.length, 0);
  win.happyDOM.setURL("http://directory3.org/login.php"); assert.equal(runListingAutofill(profile).filled.length, 0);
});

test("async repeated autofill preserves run identity and manual stage without storage, media, success or Sheets side effects", async t => {
  const { doc } = setup(t);
  doc.body.insertAdjacentHTML("beforeend", '<select name="country"><option value="">Country</option><option value="US">United States</option></select>');
  const run = createListingRun(location.href, profile.id, 7);
  for (let i = 0; i < 2; i++) {
    const report = await runListingAutofillAsync({ ...profile, country: "United States" });
    assert.equal(report.filled.length, 6);
    const next = updateListingRun(run, { stage: "MANUAL_GATE", manual: report.manual });
    assert.equal(next.id, run.id); assert.equal(next.profileId, profile.id); assert.equal(next.tabId, run.tabId);
    assert.equal(next.stage, "MANUAL_GATE"); assert.equal(next.liveUrl, undefined);
  }
  assert.equal(doc.querySelector<HTMLSelectElement>('[name="country"]')!.value, "");
});
