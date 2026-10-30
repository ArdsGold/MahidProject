import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAmpBlogsWorkflow,
  transitionAmpBlogsWorkflow,
} from "./workflow-state.mjs";
import { validateAmpBlogsProfile } from "./profile.mjs";
import {
  AMP_BLOGS_ORIGIN,
  AMP_BLOGS_PAGE_STATES,
  inspectPage,
  navigateAmpBlogsPage,
  observeAmpBlogs,
} from "./observer.mjs";
import { resumeAmpBlogsPreflight } from "./preflight.mjs";

export const DEV_AUTH_PHASES = Object.freeze({
  ACCOUNT_DECISION: "ACCOUNT_DECISION_REQUIRED",
  AWAITING_MANUAL_AUTH: "AWAITING_MANUAL_AUTH",
  OUTCOME_DETECTED: "OUTCOME_DETECTED",
  AMBIGUOUS: "AMBIGUOUS",
  RESET: "RESET",
});

export const DEV_AUTH_STATE_DIR = process.env.BA2_AMP_BLOGS_STATE_DIR
  ? resolve(process.env.BA2_AMP_BLOGS_STATE_DIR)
  : join(dirname(fileURLToPath(import.meta.url)), "..", ".ampblogs-state");

const activeSessions = new Map();

function now() { return new Date().toISOString(); }

function safeList(value) { return Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(-20) : []; }

function sanitizeObservation(observation) {
  if (!observation || typeof observation !== "object") return undefined;
  return {
    url: typeof observation.url === "string" ? observation.url : "",
    title: typeof observation.title === "string" ? observation.title : "",
    pageState: observation.pageState,
    hasSignup: observation.hasSignup === true,
    hasLogin: observation.hasLogin === true,
    captcha: observation.captcha === true,
    terms: observation.terms === true,
    fields: Array.isArray(observation.fields) ? observation.fields : [],
    locators: observation.locators && typeof observation.locators === "object" ? observation.locators : {},
    unsupported: observation.unsupported === true,
  };
}

export function sanitizeDevAuthRun(run) {
  return {
    runId: run.runId,
    state: run.state,
    mode: "HUMAN_ASSISTED_AUTH",
    phase: run.phase,
    accountStatus: run.accountStatus,
    authAction: run.authAction,
    credentialsProvided: run.credentialsProvided === true,
    profileId: run.profileId,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    steps: safeList(run.steps),
    manual: safeList(run.manual),
    observations: Array.isArray(run.observations) ? run.observations.map(sanitizeObservation).filter(Boolean).slice(-10) : [],
    pageState: run.pageState,
    reason: run.reason,
    outcome: run.outcome,
    duplicatePrevented: run.duplicatePrevented === true,
  };
}

function stateFile(runId) { return join(DEV_AUTH_STATE_DIR, `dev-auth-${runId}.json`); }

async function persist(run) {
  await mkdir(DEV_AUTH_STATE_DIR, { recursive: true });
  await writeFile(stateFile(run.runId), `${JSON.stringify(sanitizeDevAuthRun(run), null, 2)}\n`, "utf8");
}

async function loadRun(runId) {
  if (typeof runId !== "string" || !/^[0-9a-f-]{20,}$/i.test(runId)) return null;
  try {
    const parsed = JSON.parse(await readFile(stateFile(runId), "utf8"));
    if (!parsed || parsed.runId !== runId || parsed.mode !== "HUMAN_ASSISTED_AUTH") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function loadActivePersistedSession() {
  try {
    const files = (await readdir(DEV_AUTH_STATE_DIR)).filter((file) => /^dev-auth-[0-9a-f-]+\.json$/i.test(file));
    const runs = await Promise.all(files.map(async (file) => {
      try {
        const run = JSON.parse(await readFile(join(DEV_AUTH_STATE_DIR, file), "utf8"));
        return run?.mode === "HUMAN_ASSISTED_AUTH" && run.phase !== DEV_AUTH_PHASES.RESET ? run : null;
      } catch {
        return null;
      }
    }));
    return runs.filter(Boolean).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0] || null;
  } catch {
    return null;
  }
}

function sessionFor(runId) {
  const current = activeSessions.get(runId);
  return current ? Promise.resolve(current) : loadRun(runId).then((run) => run ? { run } : null);
}

function publicResult(status, run, extra = {}) {
  return { ok: true, status, run: sanitizeDevAuthRun(run), ...extra };
}

function requireAccountStatus(accountStatus) {
  if (accountStatus !== "existing" && accountStatus !== "new") {
    throw new Error("A human account decision is required: accountStatus must be existing or new.");
  }
  return accountStatus;
}

function validateCredentialInput(credentials, accountStatus) {
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
    throw new Error("Credentials must be supplied only at explicit human initiation.");
  }
  const username = typeof credentials.username === "string" ? credentials.username : "";
  const email = typeof credentials.email === "string" ? credentials.email : "";
  const password = typeof credentials.password === "string" ? credentials.password : "";
  if (!username.trim() || username.length > 256) throw new Error("A valid username is required.");
  if (!password || password.length > 1024) throw new Error("A valid password is required.");
  if (accountStatus === "new" && (!email.trim() || email.length > 320)) throw new Error("A valid email is required for registration.");
  return { username, email, password };
}

function workflowStateForPage(pageState) {
  if (pageState === AMP_BLOGS_PAGE_STATES.SIGNUP_FORM) return "SIGNUP_DETECTED";
  if (pageState === AMP_BLOGS_PAGE_STATES.ACCOUNT_CREATED) return "ACCOUNT_CREATED";
  if (pageState === AMP_BLOGS_PAGE_STATES.LOGIN_FORM) return "LOGIN_DETECTED";
  if (pageState === AMP_BLOGS_PAGE_STATES.AUTHENTICATED_DASHBOARD) return "AUTHENTICATED";
  return null;
}

function uniqueField(page, fields, name) {
  if (!Array.isArray(fields) || fields.length !== 1 || !fields[0]?.selector || fields[0].selector === "input") {
    throw new Error(`AmpBlogs ${name} control is ambiguous or unavailable.`);
  }
  const locator = page.locator(fields[0].selector);
  return locator.count().then(async (count) => {
    if (count !== 1 || !await locator.isVisible() || !await locator.isEnabled()) {
      throw new Error(`AmpBlogs ${name} control is ambiguous or unavailable.`);
    }
    return locator;
  });
}

async function fillSupportedCredentials(page, observation, accountStatus, credentials) {
  const username = await uniqueField(page, observation.locators.username, "username");
  const password = await uniqueField(page, observation.locators.password, "password");
  const email = accountStatus === "new" ? await uniqueField(page, observation.locators.email, "email") : null;

  await username.fill(credentials.username);
  if (email) await email.fill(credentials.email);
  await password.fill(credentials.password);
}

function manualInstructions(accountStatus) {
  const action = accountStatus === "new" ? "registration" : "login";
  return [
    "Solve CAPTCHA manually if present.",
    "Review Terms and any account confirmation requirements manually.",
    `Review the ${action} form and submit it manually; the worker will not click the final action.`,
    "Call the human-auth resume endpoint after the manual action to classify the resulting page.",
  ];
}

export async function prepareDevAmpBlogsAuth({ context, profile } = {}) {
  const active = [...activeSessions.values()][0];
  const existing = active;
  const persisted = existing ? null : await loadActivePersistedSession();
  if ((existing?.run || persisted) && (existing?.run || persisted).phase !== DEV_AUTH_PHASES.RESET) {
    const existingRun = existing?.run || persisted;
    if (!existing && persisted) activeSessions.set(persisted.runId, { run: persisted });
    return publicResult("in-progress", { ...existingRun, duplicatePrevented: true }, { message: "An AmpBlogs human-auth run is already active; resume or reset it explicitly." });
  }

  const profileResult = validateAmpBlogsProfile(profile);
  let run = createAmpBlogsWorkflow();
  run = transitionAmpBlogsWorkflow(run, "PREFLIGHT", { mode: "HUMAN_ASSISTED_AUTH", phase: DEV_AUTH_PHASES.ACCOUNT_DECISION, profileId: profile?.profileId || "" });
  if (!profileResult.ok) {
    run = transitionAmpBlogsWorkflow(run, "NEEDS_HUMAN", {
      phase: DEV_AUTH_PHASES.ACCOUNT_DECISION,
      reason: profileResult.reason,
      manual: [profileResult.reason],
      steps: [...run.steps, "Development auth profile validation blocked the run"],
    });
    await persist(run);
    activeSessions.set(run.runId, { run });
    return publicResult("blocked", run, { profile: profileResult });
  }

  if (!context) throw new Error("An AmpBlogs browser context is required for development authentication.");
  const observations = await observeAmpBlogs(context, AMP_BLOGS_ORIGIN);
  const homepage = observations.pages.homepage;
  run = transitionAmpBlogsWorkflow(run, "OPENING_SITE", {
    profileId: profile.profileId,
    phase: DEV_AUTH_PHASES.ACCOUNT_DECISION,
    pageState: homepage.pageState,
    observations: [homepage],
    steps: [...run.steps, "Read-only AmpBlogs page observation completed"],
  });
  run = transitionAmpBlogsWorkflow(run, "NEEDS_HUMAN", {
    phase: DEV_AUTH_PHASES.ACCOUNT_DECISION,
    pageState: homepage.pageState,
    reason: "Public AmpBlogs pages cannot safely prove account existence; a human account decision is required before choosing registration or login.",
    manual: ["Confirm whether the test account already exists before continuing: accountStatus=existing or accountStatus=new."],
    steps: [...run.steps, "Stopped before account choice, credentials, CAPTCHA, Terms, and final actions"],
  });
  await persist(run);
  activeSessions.set(run.runId, { run, page: context.pages().at(-1) });
  return publicResult("needs-human", run, { observations });
}

export async function startDevAmpBlogsAuth({ context, runId, accountStatus, credentials } = {}) {
  const session = await sessionFor(runId);
  if (!session) throw new Error("No prepared AmpBlogs human-auth run is available.");
  if (session.run.phase !== DEV_AUTH_PHASES.ACCOUNT_DECISION) {
    return publicResult("blocked", { ...session.run, duplicatePrevented: true }, { message: "This AmpBlogs auth run already progressed; reset it explicitly before starting another run." });
  }
  const status = requireAccountStatus(accountStatus);
  let supplied = validateCredentialInput(credentials, status);
  let run = session.run;
  const action = status === "new" ? "signup" : "login";
  try {
    const page = session.page || context?.pages().at(-1) || await context?.newPage();
    if (!page) throw new Error("An AmpBlogs browser page is unavailable.");
    const homepage = await inspectPage(page, AMP_BLOGS_ORIGIN);
    if (homepage.pageState !== AMP_BLOGS_PAGE_STATES.HOMEPAGE) throw new Error(`AmpBlogs account start stopped at unexpected page state ${homepage.pageState}.`);
    const observation = await navigateAmpBlogsPage(page, action);
    const expectedState = action === "signup" ? AMP_BLOGS_PAGE_STATES.SIGNUP_FORM : AMP_BLOGS_PAGE_STATES.LOGIN_FORM;
    if (observation.pageState !== expectedState) throw new Error(`AmpBlogs ${action} form was not recognized safely.`);
    await fillSupportedCredentials(page, observation, status, supplied);
    const workflowState = workflowStateForPage(observation.pageState);
    if (!workflowState) throw new Error("AmpBlogs auth form state could not be recorded safely.");
    run = transitionAmpBlogsWorkflow(run, workflowState, { pageState: observation.pageState, accountStatus: status, authAction: action });
    run = transitionAmpBlogsWorkflow(run, "NEEDS_HUMAN", {
      phase: DEV_AUTH_PHASES.AWAITING_MANUAL_AUTH,
      credentialsProvided: true,
      pageState: observation.pageState,
      reason: "Supported credentials were filled after explicit human initiation; all CAPTCHA, Terms, confirmation, and final actions remain manual.",
      manual: manualInstructions(status),
      steps: [...run.steps, `Filled unique ${action} username/password${status === "new" ? "/email" : ""} controls`, "Stopped before CAPTCHA, Terms, confirmation, and final submission"],
    });
    await persist(run);
    activeSessions.set(run.runId, { run, page });
    return publicResult("needs-human", run, { observation: sanitizeObservation(observation), message: "Credentials were accepted for the explicit human-assisted step; no final action was performed." });
  } finally {
    supplied = undefined;
  }
}

export async function resumeDevAmpBlogsAuth({ context, runId } = {}) {
  const session = await sessionFor(runId);
  if (!session) throw new Error("No prepared AmpBlogs human-auth run is available.");
  if (session.run.phase === DEV_AUTH_PHASES.OUTCOME_DETECTED || session.run.phase === DEV_AUTH_PHASES.AMBIGUOUS) {
    return publicResult("blocked", { ...session.run, duplicatePrevented: true }, { message: "This auth outcome is already recorded; no automatic continuation is allowed." });
  }
  if (session.run.phase !== DEV_AUTH_PHASES.AWAITING_MANUAL_AUTH) {
    return publicResult("blocked", session.run, { message: "Human credentials and account decision are required before resume." });
  }
  const page = session.page || context?.pages().at(-1);
  if (!page) throw new Error("No AmpBlogs page is available for human-auth resume.");
  const resumed = await resumeAmpBlogsPreflight({ context, run: session.run, page });
  const observation = resumed.observation;
  const outcome = [AMP_BLOGS_PAGE_STATES.ACCOUNT_CREATED, AMP_BLOGS_PAGE_STATES.AUTHENTICATED_DASHBOARD, AMP_BLOGS_PAGE_STATES.AUTH_ERROR].includes(observation.pageState);
  const expectedForm = session.run.authAction === "signup" ? AMP_BLOGS_PAGE_STATES.SIGNUP_FORM : AMP_BLOGS_PAGE_STATES.LOGIN_FORM;
  const ambiguous = observation.pageState === AMP_BLOGS_PAGE_STATES.UNSUPPORTED || (!outcome && observation.pageState !== expectedForm);
  const phase = outcome ? DEV_AUTH_PHASES.OUTCOME_DETECTED : ambiguous ? DEV_AUTH_PHASES.AMBIGUOUS : DEV_AUTH_PHASES.AWAITING_MANUAL_AUTH;
  const next = {
    ...session.run,
    ...resumed.run,
    phase,
    pageState: observation.pageState,
    outcome: outcome ? observation.pageState : undefined,
    reason: outcome
      ? `Manual ${session.run.authAction} action result observed as ${observation.pageState}.`
      : ambiguous
        ? `Unexpected AmpBlogs page state ${observation.pageState}; stopping without continuation.`
        : "Manual CAPTCHA, Terms review, or final action has not produced a new account outcome.",
    manual: outcome ? ["Review the observed outcome manually; no further automatic authentication action is available."] : session.run.manual,
    steps: [...(resumed.run.steps || session.run.steps), `Human-auth resume observed ${observation.pageState}`],
    observations: [...(resumed.run.observations || session.run.observations || []), observation].slice(-10),
  };
  await persist(next);
  activeSessions.set(next.runId, { run: next, page });
  return publicResult(outcome ? "outcome-detected" : ambiguous ? "blocked" : "needs-human", next, { observation: sanitizeObservation(observation) });
}

export async function resetDevAmpBlogsAuth({ runId, allowActiveReset = false } = {}) {
  const session = await sessionFor(runId);
  if (!session) throw new Error("No prepared AmpBlogs human-auth run is available.");
  const resettable = [DEV_AUTH_PHASES.OUTCOME_DETECTED, DEV_AUTH_PHASES.AMBIGUOUS].includes(session.run.phase)
    || (allowActiveReset && session.run.phase === DEV_AUTH_PHASES.AWAITING_MANUAL_AUTH);
  if (!resettable) {
    throw new Error("An active human-auth run can only be reset after an observed outcome or ambiguity.");
  }
  const run = { ...session.run, phase: DEV_AUTH_PHASES.RESET, reason: "Explicit human reset recorded; no browser action was performed.", duplicatePrevented: false, updatedAt: now() };
  await persist(run);
  activeSessions.delete(runId);
  return publicResult("reset", run);
}
