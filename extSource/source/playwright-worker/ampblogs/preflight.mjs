import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAmpBlogsWorkflow, isReadOnlyAmpBlogsState, sanitizeAmpBlogsWorkflow, transitionAmpBlogsWorkflow } from "./workflow-state.mjs";
import { AMP_BLOGS_ROW_NUMBER, AMP_BLOGS_SHEET_NAME, readAmpBlogsSheet } from "./sheets.mjs";
import { validateAmpBlogsProfile } from "./profile.mjs";
import { AMP_BLOGS_PAGE_STATES, inspectCurrentPage, observeAmpBlogs } from "./observer.mjs";

export const AMP_BLOGS_STATE_DIR = process.env.BA2_AMP_BLOGS_STATE_DIR
  ? resolve(process.env.BA2_AMP_BLOGS_STATE_DIR)
  : join(dirname(fileURLToPath(import.meta.url)), "..", ".ampblogs-state");

async function persist(run) {
  await mkdir(AMP_BLOGS_STATE_DIR, { recursive: true });
  await writeFile(join(AMP_BLOGS_STATE_DIR, `${run.runId}.json`), `${JSON.stringify(sanitizeAmpBlogsWorkflow(run), null, 2)}\n`, "utf8");
}

function workflowStateForPage(pageState) {
  if (pageState === AMP_BLOGS_PAGE_STATES.SIGNUP_FORM) return "SIGNUP_DETECTED";
  if (pageState === AMP_BLOGS_PAGE_STATES.ACCOUNT_CREATED) return "ACCOUNT_CREATED";
  if (pageState === AMP_BLOGS_PAGE_STATES.LOGIN_FORM) return "LOGIN_DETECTED";
  if (pageState === AMP_BLOGS_PAGE_STATES.AUTHENTICATED_DASHBOARD) return "AUTHENTICATED";
  return null;
}

async function stopForHumanObservation(run, observation, reason) {
  const next = workflowStateForPage(observation.pageState);
  let updated = run;
  if (next && next !== updated.state) updated = transitionAmpBlogsWorkflow(updated, next, { pageState: observation.pageState });
  updated = transitionAmpBlogsWorkflow(updated, "NEEDS_HUMAN", {
    pageState: observation.pageState,
    observations: [...(updated.observations || []), observation],
    reason,
    manual: [...new Set([...(updated.manual || []), reason])],
    steps: [...(updated.steps || []), `Observed AmpBlogs page state ${observation.pageState}`, "Stopped before credentials, CAPTCHA, Terms, or form submission"],
  });
  return updated;
}

export async function runAmpBlogsPreflight({ chromium, context: suppliedContext, profile, profileDir, fetchImpl, keepOpen = false } = {}) {
  let run = createAmpBlogsWorkflow({ rowNumber: AMP_BLOGS_ROW_NUMBER, sheetName: AMP_BLOGS_SHEET_NAME });
  run = transitionAmpBlogsWorkflow(run, "PREFLIGHT", { steps: ["Read-only preflight started"] });
  await persist(run);

  const profileResult = validateAmpBlogsProfile(profile);
  if (!profileResult.ok) {
    run = transitionAmpBlogsWorkflow(run, "NEEDS_HUMAN", { reason: profileResult.reason, manual: [profileResult.reason], steps: [...run.steps, "Active profile validation blocked preflight"] });
    await persist(run);
    return { status: "blocked", run: sanitizeAmpBlogsWorkflow(run), profile: profileResult };
  }

  const sheet = await readAmpBlogsSheet({ fetchImpl });
  if (sheet.status !== "ready") {
    run = transitionAmpBlogsWorkflow(run, "NEEDS_HUMAN", { reason: sheet.reason, manual: [sheet.reason, ...(sheet.setupPlan || [])], steps: [...run.steps, "Google Sheets read-only authorization blocked preflight"] });
    await persist(run);
    return { status: "blocked", run: sanitizeAmpBlogsWorkflow(run), profile: profileResult, sheet };
  }
  run = transitionAmpBlogsWorkflow(run, "OPENING_SITE", {
    directoryUrl: sheet.row.directoryUrl,
    existingListingUrl: sheet.row.existingListingUrl,
    existingStatus: sheet.row.existingStatus,
    steps: [...run.steps, "A18:C18 read-only row validated", "Opening dedicated AmpBlogs browser context"],
  });
  await persist(run);

  if (!suppliedContext && !chromium) throw new Error("Playwright chromium is required for AmpBlogs preflight.");
  if (!isReadOnlyAmpBlogsState(run.state)) throw new Error(`Unsafe AmpBlogs preflight state: ${run.state}`);
  const context = suppliedContext || await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
    args: ["--no-first-run"],
  });
  try {
    const observations = await observeAmpBlogs(context, sheet.row.directoryUrl || "https://ampblogs.com");
    const homepage = observations.pages.homepage;
    const recognizedEntry = observations.pages.signup || observations.pages.login;
    const observed = recognizedEntry || homepage;
    const reason = observed.pageState === "UNSUPPORTED"
      ? "Unexpected or unsupported AmpBlogs page state requires review."
      : "Read-only preflight complete; authentication actions require human approval.";
    run = await stopForHumanObservation(run, observed, reason);
    run = { ...run, observations: [...(run.observations || []), observations] };
    await persist(run);
    return { status: "needs-human", run: sanitizeAmpBlogsWorkflow(run), profile: profileResult, sheet, observations };
  } finally {
    if (!suppliedContext && !keepOpen) await context.close();
  }
}

export async function resumeAmpBlogsPreflight({ context, run: previousRun, page } = {}) {
  if (!context) throw new Error("An existing AmpBlogs browser context is required to resume observation.");
  if (!previousRun || previousRun.state !== "NEEDS_HUMAN") throw new Error("AmpBlogs resume requires a prior NEEDS_HUMAN workflow.");
  const currentPage = page || context.pages().at(-1);
  if (!currentPage) throw new Error("No AmpBlogs page is available for human-intervention resume.");
  const observation = await inspectCurrentPage(currentPage);
  const reason = observation.pageState === AMP_BLOGS_PAGE_STATES.UNSUPPORTED
    ? "Unexpected or unsupported AmpBlogs page state requires human review."
    : "Human-intervention page observed read-only; no credential or form action was attempted.";
  const run = await stopForHumanObservation(previousRun, observation, reason);
  await persist(run);
  return { status: "needs-human", run: sanitizeAmpBlogsWorkflow(run), observation };
}
