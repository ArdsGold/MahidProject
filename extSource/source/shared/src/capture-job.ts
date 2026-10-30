import { normalizeSourceSnapshot, type SourceCaptureType, type SourceSnapshot } from "./source-capture.ts";

export type CaptureJobStatus = "requested" | "finding-tab" | "waiting-for-page" | "capturing" | "success" | "action-required" | "error";

export interface CaptureJob {
  id: string;
  sourceType: SourceCaptureType;
  sourceUrl: string;
  status: CaptureJobStatus;
  message?: string;
  matchedTabUrl?: string;
  snapshot?: SourceSnapshot;
  createdAt: string;
  updatedAt: string;
}

function isStatus(value: unknown): value is CaptureJobStatus {
  return value === "requested" || value === "finding-tab" || value === "waiting-for-page" || value === "capturing" || value === "success" || value === "action-required" || value === "error";
}

export function normalizeCaptureJob(value: unknown): CaptureJob | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id || (raw.sourceType !== "website" && raw.sourceType !== "gmb") || typeof raw.sourceUrl !== "string" || !isStatus(raw.status) || typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string") return null;
  const snapshot = raw.snapshot ? normalizeSourceSnapshot(raw.snapshot) : null;
  return { id: raw.id, sourceType: raw.sourceType, sourceUrl: raw.sourceUrl, status: raw.status, message: typeof raw.message === "string" ? raw.message : undefined, matchedTabUrl: typeof raw.matchedTabUrl === "string" ? raw.matchedTabUrl : undefined, snapshot: snapshot ?? undefined, createdAt: raw.createdAt, updatedAt: raw.updatedAt };
}

export function createCaptureJob(id: string, sourceType: SourceCaptureType, sourceUrl: string): CaptureJob {
  const now = new Date().toISOString();
  return { id, sourceType, sourceUrl, status: "requested", createdAt: now, updatedAt: now };
}
