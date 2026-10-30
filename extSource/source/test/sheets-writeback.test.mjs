import assert from "node:assert/strict";
import test from "node:test";
import { AMP_BLOGS_SHEET_ID, SHEETS_WRITE_SCOPE, findListingSheetRow, normalizeListingDomain, readAmpBlogsSheet, writeVerifiedListingToSheet } from "../playwright-worker/ampblogs/sheets.mjs";
import { handleSheetsWriteBack, sheetsCors } from "../web/src/lib/sheets-writeback.ts";
import { getGoogleSheetsAccessToken } from "../playwright-worker/ampblogs/google-credentials.mjs";

test("supplied server token takes precedence without opening local credentials", async () => {
  const token = await getGoogleSheetsAccessToken({ env: { BA2_GOOGLE_SHEETS_ACCESS_TOKEN: "fixture-token" }, run: async () => { throw Error("must not run"); } });
  assert.equal(token, "fixture-token");
});

test("ADC refresh is a bounded private SDK pipe and errors never escape", async () => {
  const options = { env: { LOCALAPPDATA: "fixture-local-app-data" }, platform: "win32" };
  let calls = 0;
  const token = await getGoogleSheetsAccessToken({ ...options, run: async (executable, args, config) => {
    calls += 1;
    assert.match(executable, /bundledpython[\\/]python\.exe$/);
    assert.equal(args.includes("fixture-token"), false, "token cannot be a process argument");
    assert.equal(config.windowsHide, true);
    assert.equal(config.timeout, 30_000);
    return { stdout: JSON.stringify({ accessToken: "fixture-token" }) };
  } });
  assert.equal(token, "fixture-token");
  assert.equal(calls, 1);
  assert.equal(await getGoogleSheetsAccessToken({ ...options, run: async () => { throw Error("sensitive child diagnostics"); } }), "");
  assert.equal(await getGoogleSheetsAccessToken({ ...options, run: async () => ({ stdout: "invalid sensitive output" }) }), "");
  assert.equal(await getGoogleSheetsAccessToken({ env: {}, platform: "win32", run: async () => { throw Error("must not run"); } }), "");
  assert.equal(await getGoogleSheetsAccessToken({ ...options, platform: "linux", run: async () => { throw Error("must not run"); } }), "");
});

test("read connection failures do not expose transport diagnostics", async () => {
  const result = await readAmpBlogsSheet({ accessToken: "fixture-token", fetchImpl: async () => { throw Error("sensitive fixture-token"); } });
  assert.equal(result.code, "sheets-network");
  assert.equal(JSON.stringify(result).includes("fixture-token"), false);
});

const publicUrl = "https://onesmablog.com/fixture-article-12345";
const input = () => ({ publicationAuthorized: true, businessName: "Hot Mess Cleanup & Junk Removal", websiteUrl: "https://onesmablog.com/", liveUrl: publicUrl,
  verification: { status: "verified", url: publicUrl, checkedAt: new Date().toISOString() } });
const fakeKey = "fixture-backend-key-never-a-production-secret";
const extensionId = "a".repeat(32);
const env = () => ({ BA2_SHEETS_WRITEBACK_KEY: fakeKey, BA2_SHEETS_EXTENSION_ID: extensionId, BA2_SHEETS_WRITE_APPROVED: "true", BA2_GOOGLE_SHEETS_ACCESS_TOKEN: "fixture-oauth-token" });
const request = (body = input(), headers = {}) => new Request("http://localhost:3000/api/google-sheets/write-back", {
  method: "POST", headers: { origin: `chrome-extension://${extensionId}`, "x-ba2-sheets-key": fakeKey, "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});

function fixture(rows = [["https://other.test/", "", "unchanged"], ["https://www.onesmablog.com/", "", "keep C", "keep D", "keep E", "keep F", "keep G"]], options = {}) {
  const sheet = structuredClone(rows);
  const calls = [];
  let scans = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.authorization, "Bearer fixture-oauth-token");
    assert.equal(String(url).includes("fixture-oauth-token"), false, "OAuth token must never enter URL/query");
    if (String(url) === "https://oauth2.googleapis.com/tokeninfo") {
      assert.equal(init.method, "POST");
      return Response.json({ scope: options.readonly ? "https://www.googleapis.com/auth/spreadsheets.readonly" : SHEETS_WRITE_SCOPE, expires_in: 3600 });
    }
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "sheets.googleapis.com");
    const prefix = `/v4/spreadsheets/${AMP_BLOGS_SHEET_ID}/values/`;
    assert.ok(parsed.pathname.startsWith(prefix), "only original sheet may be accessed");
    const range = decodeURIComponent(parsed.pathname.slice(prefix.length));
    if (init.method === "PUT") {
      assert.match(range, /^Sheet1!B\d+$/, "write only one column B cell");
      assert.equal(parsed.searchParams.get("valueInputOption"), "RAW");
      const body = JSON.parse(init.body);
      assert.deepEqual(body.values, [[publicUrl]], "write exact URL and only one value");
      assert.equal(body.range, range);
      const index = Number(range.split("B")[1]) - 17;
      assert.ok(index >= 0);
      sheet[index][1] = options.wrongReadback ? "https://other.test/wrong" : body.values[0][0];
      if (options.lostWrite) throw Error("fixture interrupted after write; secret fixture-oauth-token");
      return Response.json({ updatedCells: 1 });
    }
    assert.equal(init.method, "GET");
    assert.equal(parsed.searchParams.get("valueRenderOption"), "FORMULA");
    if (range === "Sheet1!A17:B") {
      scans += 1;
      if (scans === 2) options.beforeSecondScan?.(sheet);
      return Response.json({ values: sheet.map(row => row.slice(0, 2)) });
    }
    assert.match(range, /^Sheet1!A\d+:B\d+$/, "read back the publisher and its B cell");
    if (options.failedReadback) throw Error("fixture readback unavailable");
    const index = Number(range.match(/A(\d+)/)[1]) - 17;
    return Response.json({ values: [sheet[index].slice(0, 2)] });
  };
  return { sheet, calls, fetchImpl, writes: () => calls.filter(call => call.method === "PUT") };
}

test("normalized domains support URL/case/www/path and reject unsafe identities", () => {
  assert.equal(normalizeListingDomain(" HTTPS://WWW.OnesmaBlog.com/new "), "onesmablog.com");
  assert.equal(normalizeListingDomain("onesmablog.com/"), "onesmablog.com");
  for (const value of ["", "not a domain", "javascript:bad", "https://user:password@onesmablog.com", "https://onesmablog.com:444"]) assert.equal(normalizeListingDomain(value), "");
  assert.equal(findListingSheetRow([["https://onesmablog.com.evil.test"]], "onesmablog.com", publicUrl).code, "no-domain-match");
});

test("matching starts at row 17 and writes/read-confirms only the matching B cell", async () => {
  const f = fixture();
  const before = structuredClone(f.sheet);
  const result = await writeVerifiedListingToSheet(input(), { accessToken: "fixture-oauth-token", writeApproved: true, fetchImpl: f.fetchImpl });
  assert.equal(result.status, "recorded");
  assert.equal(result.range, "Sheet1!B18");
  assert.equal(result.readBackConfirmed, true);
  before[1][1] = publicUrl;
  assert.deepEqual(f.sheet, before, "A, C:G and unrelated rows remain unchanged");
  assert.equal(f.writes().length, 1);
});

test("row reordering is resolved by domain, including movement before the final scan", async () => {
  const f = fixture(undefined, { beforeSecondScan: rows => rows.reverse() });
  const result = await writeVerifiedListingToSheet(input(), { accessToken: "fixture-oauth-token", writeApproved: true, fetchImpl: f.fetchImpl });
  assert.equal(result.status, "recorded");
  assert.equal(result.rowNumber, 17);
  assert.equal(f.sheet[0][1], publicUrl);
  assert.equal(f.sheet[1][1], "");
});

for (const [label, rows, code] of [
  ["duplicate domains", [["onesmablog.com"], ["https://www.onesmablog.com/new"]], "multiple-domain-matches"],
  ["no domain", [["https://other.test"]], "no-domain-match"],
  ["existing conflict", [["onesmablog.com", "https://onesmablog.com/another-article"]], "existing-url-conflict"],
  ["formula in B", [["onesmablog.com", '=IF(TRUE,"","")']], "existing-url-conflict"],
]) test(`${label}: no cells are changed`, async () => {
  const f = fixture(rows);
  const result = await writeVerifiedListingToSheet(input(), { accessToken: "fixture-oauth-token", writeApproved: true, fetchImpl: f.fetchImpl });
  assert.equal(result.code, code);
  assert.equal(f.writes().length, 0);
  assert.deepEqual(f.sheet, rows);
});

test("same existing URL is read-confirmed as already recorded without PUT", async () => {
  const f = fixture([["onesmablog.com", publicUrl]]);
  const result = await writeVerifiedListingToSheet(input(), { accessToken: "fixture-oauth-token", writeApproved: true, fetchImpl: f.fetchImpl });
  assert.equal(result.status, "already-recorded");
  assert.equal(result.readBackConfirmed, true);
  assert.equal(f.writes().length, 0);
});

test("new duplicate or conflict before mutation stops without PUT", async () => {
  for (const change of [rows => rows.push(["onesmablog.com"]), rows => { rows[1][1] = "different"; }]) {
    const f = fixture(undefined, { beforeSecondScan: change });
    const result = await writeVerifiedListingToSheet(input(), { accessToken: "fixture-oauth-token", writeApproved: true, fetchImpl: f.fetchImpl });
    assert.ok(["blocked", "conflict"].includes(result.status));
    assert.equal(f.writes().length, 0);
  }
});

test("approval/missing token/read-only scope block before any PUT", async () => {
  for (const config of [{ accessToken: "fixture-oauth-token", writeApproved: false }, { accessToken: "", writeApproved: true }, { accessToken: "fixture-oauth-token", writeApproved: true, readonly: true }]) {
    const f = fixture(undefined, config);
    const result = await writeVerifiedListingToSheet(input(), { ...config, fetchImpl: f.fetchImpl });
    assert.equal(result.status, "blocked");
    assert.equal(f.writes().length, 0);
    if (!config.accessToken || !config.writeApproved) assert.equal(f.calls.length, 0);
    else assert.equal(f.calls.length, 1, "read-only token stops at token scope inspection");
  }
});

test("empty, unverified, failed, and unauthorized publications make no requests", async () => {
  for (const patch of [{ liveUrl: "" }, { verification: { status: "failed" } }, { verification: { status: "unverified" } }, { publicationAuthorized: false }]) {
    const f = fixture();
    const result = await writeVerifiedListingToSheet({ ...input(), ...patch }, { accessToken: "fixture-oauth-token", writeApproved: true, fetchImpl: f.fetchImpl });
    assert.equal(result.status, "blocked");
    assert.equal(f.calls.length, 0);
  }
});

test("read-back mismatch, unavailable read-back, and lost response remain uncertain without retry", async () => {
  for (const options of [{ wrongReadback: true }, { failedReadback: true }, { lostWrite: true }]) {
    const f = fixture(undefined, options);
    const result = await writeVerifiedListingToSheet(input(), { accessToken: "fixture-oauth-token", writeApproved: true, fetchImpl: f.fetchImpl });
    assert.equal(result.status, "uncertain");
    assert.notEqual(result.readBackConfirmed, true);
    assert.equal(f.writes().length, 1);
    assert.equal(JSON.stringify(result).includes("fixture-oauth-token"), false);
  }
});

test("backend requires trusted extension origin/key and separate operator approval", async () => {
  for (const [headers, config] of [[{ origin: "https://onesmablog.com" }, env()], [{ "x-ba2-sheets-key": "wrong" }, env()], [{}, { ...env(), BA2_SHEETS_WRITE_APPROVED: "false" }], [{}, { ...env(), BA2_SHEETS_EXTENSION_ID: "" }]]) {
    const f = fixture();
    const result = await (await handleSheetsWriteBack(request(input(), headers), { env: config, fetchImpl: f.fetchImpl })).json();
    assert.equal(result.status, "blocked");
    assert.equal(f.calls.length, 0);
  }
  assert.deepEqual(sheetsCors(request(input(), { origin: "https://unrelated.test" }), env()), {});
});

test("backend rejects another business, external/unsafe URL, stale evidence and verification mismatch", async () => {
  for (const patch of [{ businessName: "Another business" }, { liveUrl: "https://unrelated.test/other-article" }, { liveUrl: "https://onesmablog.com/login" }, { verification: { status: "verified", url: publicUrl, checkedAt: "2000-01-01" } }, { verification: { status: "failed", url: publicUrl, checkedAt: new Date().toISOString() } }]) {
    const f = fixture();
    const result = await (await handleSheetsWriteBack(request({ ...input(), ...patch }), { env: env(), fetchImpl: f.fetchImpl })).json();
    assert.equal(result.status, "blocked");
    assert.equal(f.calls.length, 0);
  }
});

test("empty authenticated connection probe never contacts Google with writes disabled or enabled", async () => {
  for (const approval of ["false", "true"]) {
    const f = fixture();
    const response = await handleSheetsWriteBack(request({}), {
      env: { ...env(), BA2_SHEETS_WRITE_APPROVED: approval }, fetchImpl: f.fetchImpl,
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.code, approval === "true" ? "verification-required" : "write-approval-required");
    assert.equal(f.calls.length, 0);
  }
});

test("backend authenticates, preserves fixed document binding, and concurrent repeats do not overwrite", async () => {
  const f = fixture();
  const results = await Promise.all([1, 2].map(() => handleSheetsWriteBack(request({ ...input(), spreadsheetId: "untrusted-document", range: "Sheet1!G1" }), { env: env(), fetchImpl: f.fetchImpl }).then(response => response.json())));
  assert.deepEqual(results.map(result => result.status), ["recorded", "already-recorded"]);
  assert.equal(f.writes().length, 1);
  assert.equal(results.every(result => result.readBackConfirmed), true);
});

test("existing read-only AmpBlogs reader remains GET-only at its existing range", async () => {
  const methods = [];
  const result = await readAmpBlogsSheet({ accessToken: "fixture-read-token", fetchImpl: async (url, init) => {
    methods.push(init.method);
    assert.ok(decodeURIComponent(url).endsWith("Sheet1!A18:C18"));
    return Response.json({ values: [["https://ampblogs.com", "", "Live"]] });
  } });
  assert.equal(result.status, "ready");
  assert.deepEqual(methods, ["GET"]);
});

test('automatic preparation resolves only the original matching B cell without writes', async () => {
  for (const approved of ['false', 'true']) {
    for (const [value, status] of [['', 'ready'], [publicUrl, 'already-recorded'], ['https://other.test/article', 'conflict'], ['=FORMULA()', 'conflict']]) {
      const f = fixture([['https://other.test/', ''], ['https://onesmablog.com/', value, 'preserve C']]);
      const original = structuredClone(f.sheet);
      const req = request();
      const response = await handleSheetsWriteBack(new Request(req.url + '?mode=prepare', req), { env: { ...env(), BA2_SHEETS_WRITE_APPROVED: approved }, fetchImpl: f.fetchImpl });
      const result = await response.json();
      assert.equal(result.status, status);
      assert.equal(result.range, 'Sheet1!B18');
      assert.deepEqual(f.calls.map(c => c.method), ['GET'], 'preparation cannot write even with the global flag enabled');
      assert.deepEqual(f.sheet, original);
    }
  }
});

test('preparation preserves auth/verification/domain guards with writes disabled', async () => {
  for (const [body, headers] of [[input(), { 'x-ba2-sheets-key': 'wrong' }], [{ ...input(), verification: { status: 'unverified' } }, {}]]) {
    let calls = 0;
    const req = request(body, headers);
    const result = await handleSheetsWriteBack(new Request(req.url + '?mode=prepare', req), { env: { ...env(), BA2_SHEETS_WRITE_APPROVED: 'false' }, fetchImpl: async () => { calls++; throw Error('must not access Google'); } });
    assert.equal((await result.json()).status, 'blocked');
    assert.equal(calls, 0);
  }
  const f = fixture([['https://onesmablog.com/', ''], ['https://www.onesmablog.com/', '']]);
  const result = await writeVerifiedListingToSheet(input(), { accessToken: 'fixture-oauth-token', prepareOnly: true, writeApproved: false, fetchImpl: f.fetchImpl });
  assert.equal(result.code, 'multiple-domain-matches');
  assert.equal(f.writes().length, 0);
});
