import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, STORAGE_KEYS, type BusinessProfile } from "@backlink-autofill/shared";
import { createListingRun, LISTING_RUN_KEY, type ListingRun } from "../../src/listing-run";
import { runListingAutofill } from "../../src/content/listing-autofill";
import { authorizeDirectory3, claimDirectory3, digestDirectory3Material, observeDirectory3ManualSubmit, progressDirectory3 } from "../../src/directory3-coordinator";
import { inspectDirectory3Continuation, submitDirectory3Once, verifyDirectory3Html, discoverDirectory3Html, watchDirectory3Continuation, stopDirectory3Watch } from "../../src/content/directory3-continuation";
import { classifyDirectory3Response, directory3Digest, directory3ReceiptKey, type Directory3Review } from "../../src/automation/directory3-submission";

const fixture = readFileSync(new URL("../../family3/fixtures/directory3.html", import.meta.url), "utf8");
const detailFixture = readFileSync(new URL("../../family3/fixtures/directory3-public-detail.html", import.meta.url), "utf8");
const searchFixture = readFileSync(new URL("../../family3/fixtures/directory3-public-search.html", import.meta.url), "utf8");
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "directory3-manual-test", businessName: "Example Test Business", contactName: "Example Test Owner", email: "owner@example.test", website: "https://example.test/business", description: "Approved long business description with enough identity evidence for public verification.", category: "Web Design", createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z" };
const clone = <T>(value: T): T => structuredClone(value);
const detail = (name = profile.businessName) => `<table><tr><td class="label">Listing ID:</td><td>277455</td></tr><tr><td class="label">Title:</td><td><a href="${profile.website}">${name}</a></td></tr><tr><td class="label">Description:</td><td>${profile.description}</td></tr></table>`;
const search = `<table><tr><td id="links"><div><a href="${profile.website}">${profile.businessName}</a></div><p>${profile.description} <a href="/details.php?id=277455">Link Details</a></p></td></tr></table>`;

function setup(t: TestContext) {
  const win = new Window({ url: "http://directory3.org/submit.php", settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event", "MutationObserver"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  win.document.write(fixture);
  const doc = win.document as unknown as Document;
  let ready = "complete";
  Object.defineProperty(doc, "readyState", { get: () => ready, configurable: true });
  const initial = createListingRun(location.href, profile.id, 7);
  const values: Record<string, unknown> = { [STORAGE_KEYS.activeProfile]: { profile: clone(profile), syncedAt: new Date().toISOString(), source: "local-storage" }, [LISTING_RUN_KEY]: { ...initial, stage: "MANUAL_GATE" } };
  let clicks = 0, repairs = 0, missing = false, publicBody = detail(), searchBody = search;
  const commands: string[] = [], fetched: string[] = [];
  const sender = { id: "test-extension", frameId: 0, tab: { id: 7 }, url: location.href } as chrome.runtime.MessageSender;
  const oldFetch = globalThis.fetch;
  g.fetch = async (url: string, init: RequestInit) => {
    fetched.push(url); assert.equal(init.method, "GET"); assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error");
    return new Response(new URL(url).pathname === "/index.php" ? searchBody : publicBody, { status: 200, headers: { "content-type": "text/html" } });
  };
  g.chrome = {
    runtime: { id: sender.id, sendMessage: async (message: { type: string; runId: string }) => {
      if (message.type === "BA2_D3_CHANGED") { await progressDirectory3(message.runId); return { ok: true }; }
      if (message.type === "BA2_D3_MANUAL_SUBMIT") return observeDirectory3ManualSubmit(message.runId, sender);
      throw Error("Unexpected content command");
    } },
    storage: { local: { get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, clone(values[key])])), set: async (patch: Record<string, unknown>) => { Object.assign(values, clone(patch)); } } },
    scripting: { executeScript: async (request: unknown) => { assert.deepEqual(request, { target: { tabId: 7, frameIds: [0] }, files: ["content/directory3-receiver.js"] }); repairs++; } },
    tabs: { get: async () => ({ id: 7, url: win.location.href }), sendMessage: async (id: number, message: { type: string; html: string; url: string; review: Directory3Review }, options: { frameId: number }) => {
      assert.equal(id, 7); assert.equal(options.frameId, 0); commands.push(message.type);
      if (message.type === "BA2_D3_INSPECT") { if (missing) { missing = false; throw Error("Receiving end does not exist"); } return inspectDirectory3Continuation(); }
      if (message.type === "BA2_D3_WATCH") return { ok: true };
      if (message.type === "BA2_D3_VERIFY_HTML") return { ok: verifyDirectory3Html(message.html, message.url, message.review) };
      if (message.type === "BA2_D3_DISCOVER_HTML") return { candidates: discoverDirectory3Html(message.html, message.url, message.review) };
      throw Error("Unexpected submission command: " + message.type);
    } },
  };
  runListingAutofill(profile);
  Object.defineProperty(doc.querySelector('input[name="submit"]'), "click", { value: () => { clicks++; } });
  t.after(async () => { stopDirectory3Watch(); globalThis.fetch = oldFetch; await win.happyDOM.close(); });
  const run = () => values[LISTING_RUN_KEY] as ListingRun;
  return { doc, win, values, run, sender, commands, fetched, arm: () => progressDirectory3(run().id), manual: () => observeDirectory3ManualSubmit(run().id, sender), clicks: () => clicks, repairs: () => repairs, missing: () => { missing = true; }, publicBody: (value: string) => { publicBody = value; }, searchBody: (value: string) => { searchBody = value; }, ready: (value: string) => { ready = value; } };
}

test("autofill arms passive observation with no Review/authorization/CAPTCHA dependency or click", async t => {
  const s = setup(t); const id = s.run().id; await s.arm();
  assert.equal(s.run().id, id); assert.equal(s.run().directory3?.phase, "observing");
  assert.equal(s.run().directory3?.authorizationId, undefined); assert.equal(s.run().directory3?.observation?.resultAt, undefined);
  assert.match(s.run().manual[0], /click Continue/); assert.equal(s.clicks(), 0);
  assert(!s.commands.includes("BA2_D3_SUBMIT"));
});
test("all legacy automatic-submit messages are refused even with fresh stored consent and CAPTCHA", async t => {
  const s = setup(t); await s.arm(); const state = s.run().directory3!;
  Object.assign(state, { phase: "authorized", authorizationId: "preserved", termsAcceptedAt: Date.now(), expiresAt: Date.now()+300000 });
  const response = s.doc.createElement("textarea"); response.name = "g-recaptcha-response"; response.value = "synthetic-response"; s.doc.querySelector('.g-recaptcha')!.append(response);
  await s.arm(); assert.equal((await authorizeDirectory3(s.run().id, state.review.digest, true, true)).ok, false);
  assert.equal((await claimDirectory3(s.run().id, "legacy", s.sender)).ok, false);
  assert.equal((await submitDirectory3Once(s.run().id, "legacy")).ok, false);
  assert.equal(s.run().directory3!.authorizationId, "preserved"); assert.equal(s.clicks(), 0);
  assert(!JSON.stringify(s.values).includes("synthetic-response"));
});
test("observed human submit appends guards once and does not click, block, or overwrite old receipts", async t => {
  const s = setup(t); await s.arm(); const key = directory3ReceiptKey(s.run().directory3!.review.identityKey);
  const old = { runId: "older-run", intentId: "old-intent", claimed: true, outcome: "uncertain", digest: "old" }; s.values[key] = clone(old);
  await s.manual(); const intent = s.run().directory3!.intentId; await s.manual();
  assert.deepEqual(s.values[key], old); assert.equal(s.run().directory3!.intentId, intent);
  assert(s.run().directory3!.observation?.submittedAt); assert.equal(s.clicks(), 0);
});
test("wrong frame/tab/origin cannot report a human submit", async t => {
  const s = setup(t); await s.arm();
  for (const sender of [{ ...s.sender, frameId: 1 }, { ...s.sender, id: "foreign" }, { ...s.sender, url: "https://example.test/" }]) assert.equal((await observeDirectory3ManualSubmit(s.run().id, sender)).ok, false);
  assert.equal(s.run().directory3!.intentId, undefined);
});
test("result completion needs no success CSS or wording; unknown same-page result is not publication", async t => {
  const s = setup(t); await s.arm(); await s.manual(); s.doc.body.innerHTML = '<div class="mainContent">The request has completed. Reference 123.</div>';
  await s.arm(); assert(s.run().directory3!.observation?.resultAt); assert.equal(s.run().directory3!.outcome, "uncertain");
  assert.equal(s.run().liveUrl, undefined); assert.equal(s.run().directory3!.sheetPreparation, undefined);
  assert.equal(s.clicks(), 0); await s.arm(); assert.equal(s.fetched.length, 0);
});
test("new-document result is observed without a captured extension intent or another autofill", async t => {
  const s = setup(t); await s.arm(); s.win.location.href = "http://directory3.org/submit.php?result=opaque";
  s.doc.body.innerHTML = '<p>Processing has finished.</p>'; await s.arm();
  assert(s.run().directory3!.observation?.resultAt); assert.equal(s.run().directory3!.outcome, "uncertain"); assert.equal(s.run().directory3!.intentId, undefined);
});
test("an already-rendered opaque result is inspected on recovery without saved extension intent", async t => {
  const s = setup(t); const id = s.run().id;
  s.doc.body.innerHTML = '<div class="mainContent">Request processed. Reference 123.</div>';
  await s.arm();
  assert.equal(s.run().id, id); assert(s.run().directory3!.observation?.resultAt);
  assert.equal(s.run().directory3!.outcome, "uncertain"); assert.equal(s.run().liveUrl, undefined);
  assert.equal(s.run().directory3!.intentId, undefined); assert.equal(s.clicks(), 0);
});
test("read-only watcher automatically observes same-page manual result and never refills", async t => {
  const s = setup(t); await s.arm(); await s.manual(); watchDirectory3Continuation();
  s.doc.body.innerHTML = '<div class="mainContent">Your link is awaiting review.</div>';
  const deadline = Date.now()+2000; while (s.run().directory3?.outcome !== "pending" && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(s.run().directory3!.outcome, "pending"); assert.equal(s.clicks(), 0); assert(!s.commands.includes("BA2_LISTING_AUTOFILL"));
});
test("pending, validation, rejection and duplicate are distinct, without fixed message classes", async t => {
  const s = setup(t);
  for (const [text,expected] of [["Your link is awaiting review.","pending"],["URL already exists in the database.","duplicate"],["Email is invalid.","validation-error"],["Submission rejected.","rejected"],["Your link was successfully submitted.","accepted"]]) {
    s.doc.body.innerHTML = `<div class="mainContent"><p>${text}</p></div>`; assert.equal(classifyDirectory3Response(s.doc,location.origin).outcome,expected);
  }
  s.doc.body.innerHTML = '<div class="mainContent">Your link was successfully submitted. Submission rejected.</div>';
  assert.equal(classifyDirectory3Response(s.doc,location.origin).outcome,"uncertain");
});
test("initial native Smarty warning and CAPTCHA instructions are not a validation result", async t => {
  const s = setup(t); await s.arm(); assert.equal(s.run().directory3!.observation?.resultAt, undefined);
  assert.equal(classifyDirectory3Response(s.doc,location.origin).outcome,"uncertain");
});
test("contradictory returned evidence is uncertain even after an earlier pending message", async t => {
  const s = setup(t); await s.arm(); await s.manual();
  s.doc.body.innerHTML = '<p>Your link is awaiting review.</p>'; await s.arm();
  assert.equal(s.run().directory3!.outcome, "pending");
  s.doc.body.innerHTML = '<p>Your link is awaiting review. Submission rejected.</p>'; await s.arm();
  assert.equal(s.run().directory3!.outcome, "uncertain"); assert.equal(s.run().liveUrl, undefined);
});
test("unified native fill arms human submission observation on a visibly parsed loading form", async t => {
  const s = setup(t);
  s.values[LISTING_RUN_KEY] = { ...s.run(), nativeDirectory: { profileUpdatedAt: profile.updatedAt, phase: "manual" } };
  s.ready("loading"); await s.arm();
  assert(s.run().directory3?.observation);
  assert.equal(s.run().directory3!.observation?.resultAt, undefined);
  await s.manual();
  assert(s.run().directory3!.observation?.submittedAt);
  assert.equal(s.clicks(), 0);
});
test("result is not marked finished while the document is still loading", async t => {
  const s = setup(t); await s.arm(); await s.manual(); s.ready("loading"); s.doc.body.innerHTML = '<p>Your link is awaiting review.</p>'; await s.arm();
  assert.equal(s.run().directory3!.observation?.resultAt,undefined); s.ready("complete"); await s.arm(); assert.equal(s.run().directory3!.outcome,"pending");
});
test("an opaque response observed during loading is still completed once ready", async t => {
  const s = setup(t); await s.arm(); await s.manual();
  const baseline = s.run().directory3!.observation!.textDigest;
  s.ready("loading"); s.doc.body.innerHTML = '<p>Request handled. Reference 123.</p>'; await s.arm();
  assert.equal(s.run().directory3!.observation!.textDigest, baseline);
  assert.equal(s.run().directory3!.observation!.resultAt, undefined);
  s.ready("complete"); await s.arm();
  assert(s.run().directory3!.observation!.resultAt); assert.equal(s.run().directory3!.outcome, "uncertain");
  assert.equal(s.run().liveUrl, undefined);
});
test("duplicate triggers one observed GET-search and verifies the exact returned detail URL", async t => {
  const s = setup(t); await s.arm(); s.doc.body.innerHTML = '<div class="mainContent">This URL already exists in the database.</div>'; await s.arm();
  assert.equal(s.run().directory3!.outcome,"duplicate"); assert.equal(s.run().liveUrl,"http://directory3.org/details.php?id=277455");
  assert.equal(s.run().directory3!.verification?.status,"verified");
  assert.deepEqual(s.fetched,["http://directory3.org/index.php?q=example.test","http://directory3.org/details.php?id=277455"]);
  await s.arm(); assert.equal(s.fetched.length,2); assert.equal(s.clicks(),0);
});
test("duplicate without public match remains duplicate with no invented URL or search retry", async t => {
  const s = setup(t); await s.arm(); s.searchBody('<p>No results</p>'); s.doc.body.innerHTML = '<p>URL already exists.</p>'; await s.arm(); await s.arm();
  assert.equal(s.run().directory3!.outcome,"duplicate"); assert.equal(s.fetched.length,1); assert.equal(s.run().liveUrl,undefined); assert.equal(s.run().directory3!.sheetPreparation,undefined);
});
test("wrong business on the returned public detail page never prepares column B", async t => {
  const s = setup(t); await s.arm(); s.publicBody(detail("Different Business")); s.doc.body.innerHTML = '<p>URL already exists.</p>'; await s.arm();
  assert.equal(s.run().liveUrl,undefined); assert.equal(s.run().directory3!.sheetPreparation,undefined); assert.equal(s.run().directory3!.outcome,"duplicate");
});
test("ambiguous existing matches do not choose an arbitrary public listing", async t => {
  const s = setup(t); await s.arm(); s.searchBody(search + search.replaceAll("277455","277456")); s.doc.body.innerHTML='<p>URL already exists.</p>'; await s.arm();
  assert.equal(s.fetched.length,1); assert.equal(s.run().liveUrl,undefined);
});
test("a returned exact detail anchor can be verified even without recognised success wording", async t => {
  const s = setup(t); await s.arm(); await s.manual(); s.doc.body.innerHTML='<p>Request handled. <a href="/details.php?id=277455">Link Details</a></p>'; await s.arm();
  assert.equal(s.run().liveUrl,"http://directory3.org/details.php?id=277455"); assert.equal(s.run().directory3!.sheetPreparation?.column,"B"); assert.equal(s.fetched.length,1);
});
test("Latest Links never becomes a candidate or publication proof", async t => {
  const s = setup(t); await s.arm(); await s.manual(); s.doc.body.innerHTML='<p>Your link is awaiting review. <a href="/index.php?p=d">Latest Links</a></p>'; await s.arm();
  assert.equal(s.run().directory3!.outcome,"pending"); assert.equal(s.fetched.length,0); assert.equal(s.run().liveUrl,undefined);
});
test("legacy runs, authorization fields, receipt guards and profile switches survive passive recovery", async t => {
  const s = setup(t); await s.arm(); const original = s.run(); const state = original.directory3!;
  delete state.observation; Object.assign(state,{phase:"attempted",intentId:"legacy-intent",authorizationId:"legacy-consent"});
  const key=directory3ReceiptKey(state.review.identityKey); const receipt={runId:original.id,intentId:"legacy-intent",claimed:true,digest:state.review.digest,outcome:"uncertain"}; s.values[key]=clone(receipt);
  (s.values[STORAGE_KEYS.activeProfile] as {profile:BusinessProfile}).profile.id="different-active-profile";
  s.doc.body.innerHTML='<p>Your link is awaiting review.</p>'; await s.arm();
  assert.equal(s.run().id,original.id); assert.equal(s.run().directory3!.intentId,"legacy-intent"); assert.equal(s.run().directory3!.authorizationId,"legacy-consent"); assert.deepEqual(s.values[key],receipt); assert.equal(s.run().directory3!.outcome,"pending"); assert.equal(s.clicks(),0);
});
test("missing receiver repairs only frame0 read-only entry, without refill or submission", async t => {
  const s=setup(t); const before=s.doc.body.innerHTML; s.missing(); await s.arm(); assert.equal(s.repairs(),1); assert.equal(s.doc.body.innerHTML,before); assert.equal(s.clicks(),0);
});
test("secure worker digest remains compatible and rejects a foreign source", async t => {
  const s=setup(t); const value={sample:"café"}; const result=await digestDirectory3Material(JSON.stringify(value),s.sender); assert(result.ok); if(result.ok) assert.equal(result.digest,await directory3Digest(value));
  assert.equal((await digestDirectory3Material("{}",{...s.sender,frameId:1})).ok,false);
});
test("actual read-only GET detail and search fixtures use labelled rows and actual returned URLs", t => {
  const s=setup(t); s.doc.body.innerHTML=detailFixture;
  const rows=[...s.doc.querySelectorAll('tr')]; const cell=(label:string)=>rows.find(row=>row.cells[0]?.textContent?.trim()===label)?.cells[1];
  const anchor=cell("Title:")!.querySelector<HTMLAnchorElement>('a')!;
  const review={name:anchor.textContent!,website:anchor.getAttribute('href')!,description:cell("Description:")!.textContent!,url:location.href} as Directory3Review;
  assert.equal(verifyDirectory3Html(detailFixture,"http://directory3.org/details.php?id=277455",review),true);
  assert.deepEqual(discoverDirectory3Html(searchFixture,"http://directory3.org/index.php?q=magnifylab.com",review),["http://directory3.org/details.php?id=277455"]);
  assert.equal(verifyDirectory3Html(detailFixture,"http://directory3.org/details.php?id=999",review),false);
});
