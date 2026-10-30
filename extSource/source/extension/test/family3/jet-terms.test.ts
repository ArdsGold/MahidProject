import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createJetTermsConsent, installJetTermsReview } from "../../src/content/jet-terms";

const fixture = readFileSync(new URL("../../family3/fixtures/jet-links.com.html", import.meta.url), "utf8");
function setup(t: TestContext) {
  const win = new Window({ url: "https://jet-links.com/submit.php", settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  win.document.write(fixture);
  const doc = win.document as unknown as Document;
  t.after(() => win.close());
  let html = '<html><head><title>Rules</title></head><body>Sample Terms for offline tests only. <a href="/policy">Policy</a></body></html>';
  let time = 1000;
  let requests = 0;
  const fetcher: typeof fetch = async (url, init) => {
    requests++; assert.equal(url, "https://jet-links.com/rules.php");
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error"); assert.equal(init?.credentials, "omit");
    return new Response(html, { headers: { "content-type": "text/html" } });
  };
  const consent = createJetTermsConsent(doc, fetcher, () => time);
  const checkbox = doc.querySelector<HTMLInputElement>('[name="agree"]')!;
  let actions = 0;
  doc.addEventListener("submit", e => { e.preventDefault(); actions++; });
  doc.addEventListener("click", () => actions++);
  doc.addEventListener("change", () => actions++);
  return { doc, consent, checkbox, setHtml: (value: string) => { html = value; }, expire: () => { time += 300001; }, requests: () => requests, actions: () => actions };
}

test("Jet Terms review does not accept; explicit current approval only checks named checkbox", async t => {
  const s = setup(t); const before = s.doc.querySelector("form")!.outerHTML;
  const review = await s.consent.review();
  assert.match(review.text, /https:\/\/jet-links.com\/policy/); assert(!review.text.includes("<html>"));
  assert.equal(s.checkbox.checked, false); assert.equal(s.doc.querySelector("form")!.outerHTML, before);
  await s.consent.approve(review.id, true);
  assert.equal(s.checkbox.checked, true); assert.equal(s.actions(), 0); assert.equal(s.requests(), 2);
  await assert.rejects(s.consent.approve(review.id, true), /Fresh explicit approval/);
});

for (const scenario of ["no-review", "false-consent", "wrong-id", "expired", "changed-terms", "changed-policy-link", "replaced-form", "changed-checkbox", "second-review"]) test(`Jet Terms refuses ${scenario}`, async t => {
  const s = setup(t); const review = scenario === "no-review" ? { id: 1 } : await s.consent.review();
  if (scenario === "expired") s.expire();
  if (scenario === "changed-terms") s.setHtml("<body>Different Terms</body>");
  if (scenario === "changed-policy-link") s.setHtml('<body>Sample Terms for offline tests only. <a href="/different-policy">Policy</a></body>');
  if (scenario === "replaced-form") s.doc.querySelector("form")!.outerHTML = s.doc.querySelector("form")!.outerHTML;
  if (scenario === "changed-checkbox") s.checkbox.value = "1";
  if (scenario === "second-review") await s.consent.review();
  await assert.rejects(s.consent.approve(scenario === "wrong-id" ? -1 : review.id, scenario !== "false-consent"));
  assert.equal(s.checkbox.checked, false); assert.equal(s.actions(), 0);
});

for (const html of [" ", "<html><body>  </body></html>", "<script>Terms are not visible</script>", "<body>403 Forbidden</body>", "<body>Verify you are human</body>"]) test(`Jet refuses unavailable Terms ${JSON.stringify(html)}`, async t => {
  const s = setup(t); s.setHtml(html);
  await assert.rejects(s.consent.review(), /empty or blocked/); assert.equal(s.checkbox.checked, false);
  await assert.rejects(s.consent.approve(1, true));
});

test("Jet Terms TLS/network failure cannot produce consent", async t => {
  const s = setup(t);
  const c = createJetTermsConsent(s.doc, async () => { throw Error("certificate failure"); });
  await assert.rejects(c.review(), /certificate failure/); await assert.rejects(c.approve(1, true)); assert.equal(s.checkbox.checked, false);
});

for (const scenario of ["http-error", "not-html", "oversized"]) test(`Jet Terms refuses response ${scenario}`, async t => {
  const s = setup(t);
  const c = createJetTermsConsent(s.doc, async () => new Response(scenario === "oversized" ? "x".repeat(200001) : "Terms", { status: scenario === "http-error" ? 403 : 200, headers: { "content-type": scenario === "not-html" ? "text/plain" : "text/html" } }));
  await assert.rejects(c.review()); await assert.rejects(c.approve(1, true)); assert.equal(s.checkbox.checked, false);
});

for (const scenario of ["replaced-during-fetch", "expired-during-fetch", "parallel-approval"]) test(`Jet approval guards asynchronous transition ${scenario}`, async t => {
  const s = setup(t); let requests = 0; let release: () => void = () => {};
  const c = createJetTermsConsent(s.doc, async () => {
    if (++requests === 2) await new Promise<void>(resolve => { release = resolve; });
    return new Response("<body>Offline sample Terms</body>", { headers: { "content-type": "text/html" } });
  }, (() => { let time = 0; return () => scenario === "expired-during-fetch" && requests >= 2 ? (time += 300001) : time; })());
  const review = await c.review(); const approval = c.approve(review.id, true);
  if (scenario === "replaced-during-fetch") s.doc.querySelector("form")!.outerHTML = s.doc.querySelector("form")!.outerHTML;
  if (scenario === "parallel-approval") await assert.rejects(c.approve(review.id, true));
  release();
  if (scenario === "parallel-approval") { await approval; assert.equal(s.checkbox.checked, true); }
  else { await assert.rejects(approval); assert.equal(s.checkbox.checked, false); }
  assert.equal(s.actions(), 0);
});

test("Jet Terms panel stays outside native form, installs once and does not infer approval", t => {
  const s = setup(t); const before = s.doc.querySelector("form")!.outerHTML;
  installJetTermsReview(s.doc); installJetTermsReview(s.doc);
  assert.equal(s.doc.querySelectorAll("#mahid-jet-terms").length, 1);
  assert.equal(s.doc.querySelector("form")!.outerHTML, before); assert.equal(s.checkbox.checked, false); assert.equal(s.requests(), 0);
  assert.equal(s.doc.querySelector("#mahid-jet-terms")!.closest("form"), null);
});
