import { randomUUID } from "node:crypto";

export const AMP_BLOGS_STATES = Object.freeze([
  "PENDING",
  "PREFLIGHT",
  "OPENING_SITE",
  "SIGNUP_DETECTED",
  "ACCOUNT_CREATED",
  "LOGIN_DETECTED",
  "AUTHENTICATED",
  "NEEDS_HUMAN",
  "READY_FOR_POST",
  "READY_FOR_REVIEW",
  "PUBLISHING",
  "SUBMITTED_UNVERIFIED",
  "PUBLISHED_VERIFIED",
  "SHEET_SYNC_PENDING",
  "COMPLETE",
  "FAILED",
  "UNKNOWN_OUTCOME",
]);

const TRANSITIONS = {
  PENDING: ["PREFLIGHT", "FAILED"],
  PREFLIGHT: ["OPENING_SITE", "NEEDS_HUMAN", "FAILED"],
  OPENING_SITE: ["SIGNUP_DETECTED", "LOGIN_DETECTED", "AUTHENTICATED", "NEEDS_HUMAN", "FAILED"],
  SIGNUP_DETECTED: ["ACCOUNT_CREATED", "LOGIN_DETECTED", "AUTHENTICATED", "NEEDS_HUMAN", "FAILED"],
  ACCOUNT_CREATED: ["LOGIN_DETECTED", "AUTHENTICATED", "NEEDS_HUMAN", "FAILED"],
  LOGIN_DETECTED: ["AUTHENTICATED", "NEEDS_HUMAN", "FAILED"],
  AUTHENTICATED: ["READY_FOR_POST", "NEEDS_HUMAN", "FAILED"],
  NEEDS_HUMAN: ["PREFLIGHT", "SIGNUP_DETECTED", "ACCOUNT_CREATED", "LOGIN_DETECTED", "AUTHENTICATED", "NEEDS_HUMAN", "READY_FOR_POST", "READY_FOR_REVIEW", "PUBLISHING", "SHEET_SYNC_PENDING", "FAILED"],
  READY_FOR_POST: ["READY_FOR_REVIEW", "NEEDS_HUMAN", "FAILED"],
  READY_FOR_REVIEW: ["PUBLISHING", "NEEDS_HUMAN", "FAILED"],
  PUBLISHING: ["SUBMITTED_UNVERIFIED", "UNKNOWN_OUTCOME", "FAILED"],
  SUBMITTED_UNVERIFIED: ["PUBLISHED_VERIFIED", "NEEDS_HUMAN", "UNKNOWN_OUTCOME", "FAILED"],
  PUBLISHED_VERIFIED: ["SHEET_SYNC_PENDING", "FAILED"],
  SHEET_SYNC_PENDING: ["COMPLETE", "NEEDS_HUMAN", "FAILED"],
  AUTHENTICATED: ["READY_FOR_POST", "NEEDS_HUMAN", "FAILED"],
  COMPLETE: [],
  FAILED: [],
  UNKNOWN_OUTCOME: ["NEEDS_HUMAN", "FAILED"],
};

export function createAmpBlogsWorkflow({ rowNumber = 18, sheetName = "Sheet1" } = {}) {
  const now = new Date().toISOString();
  return {
    runId: randomUUID(),
    state: "PENDING",
    rowNumber,
    sheetName,
    startedAt: now,
    updatedAt: now,
    steps: [],
    manual: [],
    observations: [],
  };
}

export function transitionAmpBlogsWorkflow(run, nextState, patch = {}) {
  if (!AMP_BLOGS_STATES.includes(nextState)) throw new Error(`Unknown AmpBlogs workflow state: ${nextState}`);
  if (!(TRANSITIONS[run.state] || []).includes(nextState)) throw new Error(`Invalid AmpBlogs transition: ${run.state} -> ${nextState}`);
  return {
    ...run,
    ...patch,
    state: nextState,
    updatedAt: new Date().toISOString(),
  };
}

export function isReadOnlyAmpBlogsState(state) {
  return ["PENDING", "PREFLIGHT", "OPENING_SITE", "SIGNUP_DETECTED", "ACCOUNT_CREATED", "LOGIN_DETECTED", "NEEDS_HUMAN", "FAILED"].includes(state);
}

export function sanitizeAmpBlogsWorkflow(run) {
  return {
    runId: run.runId,
    state: run.state,
    rowNumber: run.rowNumber,
    sheetName: run.sheetName,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    steps: [...(run.steps || [])],
    manual: [...(run.manual || [])],
    observations: [...(run.observations || [])],
    pageState: run.pageState,
    directoryUrl: run.directoryUrl,
    existingListingUrl: run.existingListingUrl,
    existingStatus: run.existingStatus,
    reason: run.reason,
  };
}
