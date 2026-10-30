import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { resumeAmpBlogsPreflight, runAmpBlogsPreflight } from "./ampblogs/preflight.mjs";
import { prepareDevAmpBlogsAuth, resetDevAmpBlogsAuth, resumeDevAmpBlogsAuth, startDevAmpBlogsAuth } from "./ampblogs/human-auth.mjs";
import { readWorkerConfig } from "./runtime-config.mjs";

const CONFIG = readWorkerConfig();
const { host: HOST, port: PORT, token: TOKEN, profileDir: PROFILE_DIR, ampBlogsProfileDir: AMP_BLOGS_PROFILE_DIR, extensionDir: EXTENSION_DIR, loadExtension: LOAD_EXTENSION, diagnosticsDir: DIAGNOSTIC_DIR, diagnosticsFile: DIAGNOSTIC_FILE } = CONFIG;
const MAX_BODY_BYTES = 256 * 1024;
const DEV_AUTH_ENABLED = process.env.NODE_ENV !== "production";
const DEV_AUTH_PATHS = new Set([
  "/ampblogs/dev/auth/prepare",
  "/ampblogs/dev/auth/start",
  "/ampblogs/dev/auth/resume",
  "/ampblogs/dev/auth/reset",
]);
const DIAGNOSTIC_STAGES = new Set([
  "CATEGORY_DETECTED",
  "CATEGORY_MATCH_RESULT",
  "CATEGORY_WRITE_ATTEMPT",
  "CATEGORY_WRITE_IMMEDIATE",
  "CATEGORY_WRITE_100MS",
  "CATEGORY_WRITE_500MS",
  "CATEGORY_EVENT",
  "CATEGORY_MUTATION",
  "CATEGORY_ERROR",
]);
const DIAGNOSTIC_KEYS = new Set([
  "selector", "currentValue", "currentText", "isPlaceholder", "chosenText", "chosenValue", "score", "reason",
  "targetText", "targetValue", "value", "selectedIndex", "selectedText", "event", "mutation", "stage", "errorName", "errorMessage",
]);

let context;
let ampBlogsContext;
let ampBlogsPreflightPromise;
let ampBlogsLastResult;

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-ba2-playwright-token",
  });
  response.end(JSON.stringify(body));
}

function authorized(request) {
  return request.headers["x-ba2-playwright-token"] === TOKEN;
}

function logInspectionRequest(endpoint, authenticated, success) {
  console.info("[BA2 Playwright request]", JSON.stringify({ timestamp: new Date().toISOString(), endpoint, authenticated, success }));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Request body must be a JSON object.");
  return parsed;
}

function validUrl(value) {
  if (value === undefined) return undefined;
  const url = new URL(String(value));
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http(s) page URLs are allowed.");
  return url.href;
}

async function pageFor(url) {
  const requestedUrl = validUrl(url);
  const existing = context.pages().find((page) => !requestedUrl || page.url() === requestedUrl);
  if (existing) return existing;
  const page = await context.newPage();
  if (requestedUrl) await page.goto(requestedUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
  return page;
}

function selectorFrom(body, fallback) {
  if (typeof body.selector === "string" && body.selector.trim()) return body.selector.trim();
  return fallback;
}

function safeRequestError(error, body, developmentAuth = false) {
  let message = error instanceof Error ? error.message : "Playwright request failed.";
  if (developmentAuth) {
    const secrets = [body?.credentials?.username, body?.credentials?.email, body?.credentials?.password]
      .filter((value) => typeof value === "string" && value.length > 0);
    for (const secret of secrets) message = message.split(secret).join("[redacted]");
  }
  return message;
}

async function diagnoseSelect(body) {
  if (body.selector !== 'select[name="CATEGORY_ID"]') throw new Error("Only select[name=\"CATEGORY_ID\"] diagnosis is supported.");
  const page = await pageFor(body.url);
  for (const frame of page.frames()) {
    const select = frame.locator(body.selector).first();
    if (!await select.count()) continue;
    return {
      found: true,
      frameUrl: frame.url(),
      isTopFrame: frame === page.mainFrame(),
      ...(await select.evaluate((element) => {
        const normalize = (value) => String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
        const form = element.closest("form");
        const options = element instanceof HTMLSelectElement ? Array.from(element.options) : [];
        const target = options.find((option) => normalize(option.textContent || "") === "commercial contractors");
        const hidden = element instanceof HTMLElement && (element.hidden || getComputedStyle(element).display === "none" || getComputedStyle(element).visibility === "hidden");
        return {
          outerHTML: element.outerHTML,
          tagName: element.tagName,
          name: element.getAttribute("name") || "",
          id: element.id || "",
          className: element.getAttribute("class") || "",
          currentValue: "value" in element ? String(element.value || "") : "",
          currentText: element instanceof HTMLSelectElement ? element.selectedOptions[0]?.textContent?.trim() || "" : "",
          selectedIndex: element instanceof HTMLSelectElement ? element.selectedIndex : -1,
          optionCount: options.length,
          inlineOnchange: element.getAttribute("onchange") || "",
          disabled: element instanceof HTMLSelectElement ? element.disabled : false,
          hidden,
          form: {
            id: form?.getAttribute("id") || "",
            name: form?.getAttribute("name") || "",
            action: form?.getAttribute("action") || "",
            method: (form?.getAttribute("method") || "get").toLowerCase(),
          },
          matchingOption: {
            found: Boolean(target),
            rawText: target?.textContent?.trim() || "",
            normalizedText: target ? normalize(target.textContent || "") : "",
            value: target?.value || "",
          },
        };
      })),
    };
  }
  return { found: false, selector: body.selector };
}

async function persistDiagnostic(body) {
  if (typeof body.stage !== "string" || !DIAGNOSTIC_STAGES.has(body.stage)) throw new Error("Unsupported diagnostic stage.");
  const details = body.details && typeof body.details === "object" && !Array.isArray(body.details) ? body.details : {};
  const safeDetails = Object.fromEntries(Object.entries(details)
    .filter(([key]) => DIAGNOSTIC_KEYS.has(key))
    .map(([key, value]) => [key, typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null ? value : String(value)]));
  await appendFile(DIAGNOSTIC_FILE, `${JSON.stringify({ timestamp: new Date().toISOString(), stage: body.stage, details: safeDetails })}\n`, "utf8");
  return { ok: true };
}

async function inspectSelect(body) {
  const page = await pageFor(body.url);
  const selector = selectorFrom(body, 'select[name="CATEGORY_ID"]');
  const select = page.locator(selector).first();
  if (!await select.count()) return { found: false, selector };
  return {
    found: true,
    ...(await select.evaluate((element) => {
      if (!(element instanceof HTMLSelectElement)) return { name: element.getAttribute("name") || "", id: element.id || "", currentValue: "", currentText: "", optionCount: 0, options: [] };
      return {
        name: element.name,
        id: element.id,
        currentValue: element.value,
        currentText: element.selectedOptions[0]?.textContent?.trim() || "",
        optionCount: element.options.length,
        options: Array.from(element.options).map((option) => ({ text: option.textContent?.trim() || "", value: option.value })),
      };
    })),
  };
}

async function inspectField(body) {
  const page = await pageFor(body.url);
  const selector = selectorFrom(body, "input, textarea, select");
  const field = page.locator(selector).first();
  if (!await field.count()) return { found: false, selector };
  return {
    found: true,
    ...(await field.evaluate((element) => {
      const labels = "labels" in element && element.labels ? Array.from(element.labels).map((label) => label.textContent?.trim() || "") : [];
      const nearby = element.closest("label, fieldset, td, th, .field, .form-group")?.textContent?.replace(/\s+/g, " ").trim() || element.parentElement?.textContent?.replace(/\s+/g, " ").trim() || "";
      const value = "value" in element ? String(element.value || "") : "";
      return {
        type: element.getAttribute("type") || element.tagName.toLowerCase(),
        name: element.getAttribute("name") || "",
        id: element.id || "",
        placeholder: element.getAttribute("placeholder") || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        associatedLabel: labels.join(" "),
        nearbyContext: nearby,
        valueExists: value.trim().length > 0,
      };
    })),
  };
}

async function verifyField(body) {
  const page = await pageFor(body.url);
  const selector = selectorFrom(body, 'select[name="CATEGORY_ID"]');
  const field = page.locator(selector).first();
  if (!await field.count()) return { found: false, verified: false, selector };
  return {
    found: true,
    ...(await field.evaluate((element, expected) => {
      const currentValue = "value" in element ? String(element.value || "") : "";
      const currentText = element instanceof HTMLSelectElement ? element.selectedOptions[0]?.textContent?.trim() || "" : currentValue;
      const valueMatches = expected.expectedValue === undefined || currentValue === String(expected.expectedValue);
      const normalizeVisibleText = (value) => String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
      const textMatches = expected.expectedText === undefined || normalizeVisibleText(currentText) === normalizeVisibleText(expected.expectedText);
      return { verified: valueMatches && textMatches, currentValue, currentText, valueMatches, textMatches };
    }, { expectedValue: body.expectedValue, expectedText: body.expectedText })),
  };
}

async function startAmpBlogsPreflight(body) {
  if (ampBlogsLastResult) return ampBlogsLastResult;
  if (ampBlogsPreflightPromise) return { ok: true, status: "in-progress", message: "An AmpBlogs preflight is already running." };
  const profile = body.profile && typeof body.profile === "object" && !Array.isArray(body.profile)
    ? { profileId: typeof body.profile.profileId === "string" ? body.profile.profileId : "", businessName: typeof body.profile.businessName === "string" ? body.profile.businessName : "" }
    : undefined;
  ampBlogsPreflightPromise = (async () => {
    const result = await runAmpBlogsPreflight({ context: await getAmpBlogsContext(), profile, keepOpen: true });
    const response = { ok: true, status: result.status, run: result.run, sheet: result.sheet ? { status: result.sheet.status, code: result.sheet.code, reason: result.sheet.reason, row: result.sheet.row, setupPlan: result.sheet.setupPlan } : undefined, observations: result.observations };
    ampBlogsLastResult = response;
    return response;
  })().finally(() => { ampBlogsPreflightPromise = undefined; });
  return ampBlogsPreflightPromise;
}

async function getAmpBlogsContext() {
  if (!ampBlogsContext) {
    ampBlogsContext = await chromium.launchPersistentContext(AMP_BLOGS_PROFILE_DIR, {
      headless: false,
      viewport: null,
      args: ["--no-first-run"],
    });
  }
  return ampBlogsContext;
}

async function prepareDevAuth(body) {
  return prepareDevAmpBlogsAuth({
    context: await getAmpBlogsContext(),
    profile: body.profile,
  });
}

async function startDevAuth(body) {
  return startDevAmpBlogsAuth({
    context: await getAmpBlogsContext(),
    runId: body.runId,
    accountStatus: body.accountStatus,
    credentials: body.credentials,
  });
}

async function resumeDevAuth(body) {
  return resumeDevAmpBlogsAuth({ context: await getAmpBlogsContext(), runId: body.runId });
}

async function resetDevAuth(body) {
  return resetDevAmpBlogsAuth({ runId: body.runId, allowActiveReset: body.force === true });
}

async function resumeAmpBlogsObservation() {
  if (!ampBlogsContext || !ampBlogsLastResult?.run) {
    return { ok: false, status: "blocked", message: "No resumable AmpBlogs preflight is available." };
  }
  const result = await resumeAmpBlogsPreflight({ context: ampBlogsContext, run: ampBlogsLastResult.run });
  const response = { ok: true, status: result.status, run: result.run, observation: result.observation };
  ampBlogsLastResult = response;
  return response;
}

async function handle(request, response) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-ba2-playwright-token",
    });
    response.end();
    return;
  }
  const path = new URL(request.url || "/", `http://${HOST}:${PORT}`).pathname;
  const loggedEndpoint = ["/inspect-select", "/verify-field"].includes(path) ? path : undefined;
  if (DEV_AUTH_PATHS.has(path) && !DEV_AUTH_ENABLED) {
    json(response, 404, { ok: false, error: "Development-only AmpBlogs auth is disabled." });
    return;
  }
  const authenticated = authorized(request);
  if (!authenticated) {
    if (loggedEndpoint) logInspectionRequest(loggedEndpoint, false, false);
    json(response, 401, { ok: false, error: "Unauthorized." });
    return;
  }
  if (request.method === "GET" && path === "/health") {
    json(response, 200, { ok: true, worker: "playwright", browser: Boolean(context), host: HOST, port: PORT });
    return;
  }
  if (request.method !== "POST" || !["/inspect-select", "/inspect-field", "/verify-field", "/diagnose-select", "/diagnostics", "/ampblogs/preflight", "/ampblogs/resume", ...DEV_AUTH_PATHS].includes(path)) {
    json(response, 404, { ok: false, error: "Not found." });
    return;
  }
  let body = {};
  try {
    body = await readJson(request);
    const result = path === "/ampblogs/preflight"
      ? await startAmpBlogsPreflight(body)
      : path === "/ampblogs/resume"
        ? await resumeAmpBlogsObservation()
        : path === "/ampblogs/dev/auth/prepare"
          ? await prepareDevAuth(body)
          : path === "/ampblogs/dev/auth/start"
            ? await startDevAuth(body)
            : path === "/ampblogs/dev/auth/resume"
              ? await resumeDevAuth(body)
              : path === "/ampblogs/dev/auth/reset"
                ? await resetDevAuth(body)
                : path === "/inspect-select"
                  ? await inspectSelect(body)
                  : path === "/inspect-field"
                    ? await inspectField(body)
                    : path === "/verify-field"
                      ? await verifyField(body)
                      : path === "/diagnose-select"
                        ? await diagnoseSelect(body)
                        : await persistDiagnostic(body);
    if (loggedEndpoint) logInspectionRequest(loggedEndpoint, true, true);
    json(response, 200, result);
  } catch (error) {
    if (loggedEndpoint) logInspectionRequest(loggedEndpoint, true, false);
    json(response, 400, { ok: false, error: safeRequestError(error, body, DEV_AUTH_PATHS.has(path)) });
  }
}

if (LOAD_EXTENSION && !existsSync(EXTENSION_DIR)) throw new Error(`Missing ${EXTENSION_DIR}. Run npm.cmd run build:extension first.`);
await mkdir(DIAGNOSTIC_DIR, { recursive: true });
await writeFile(DIAGNOSTIC_FILE, "", "utf8");

const extensionArgs = LOAD_EXTENSION
  ? [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`]
  : ["--disable-extensions"];
context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: null,
  args: [...extensionArgs, "--no-first-run"],
});

const server = createServer((request, response) => {
  void handle(request, response).catch((error) => json(response, 500, { ok: false, error: error instanceof Error ? error.message : "Worker failure." }));
});

server.listen(PORT, HOST, () => {
  console.log(`Playwright worker listening on http://${HOST}:${PORT}`);
  console.log(`Persistent profile: ${PROFILE_DIR}`);
  console.log(`Extension loaded from: ${EXTENSION_DIR}`);
});

async function shutdown() {
  server.close();
  await context.close();
  if (ampBlogsContext) await ampBlogsContext.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
