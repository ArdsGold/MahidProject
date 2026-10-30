// Build-time inspection mode. No persisted flag, run mutation, or consent change.
declare const __BA2_BUILD__: string;
declare const __BA2_READ_ONLY_TRACE__: boolean;
export const TRACE_READ_ONLY = typeof __BA2_READ_ONLY_TRACE__ !== 'undefined' && __BA2_READ_ONLY_TRACE__;
export const BUILD_ID = typeof __BA2_BUILD__ === 'string' ? __BA2_BUILD__ : 'unbundled-test';
export const traceSteps = ['Loaded extension build/version', 'Startup continuation executed', 'Existing Bloguetechno success tab discovered', 'Visit link recognized', 'Visit navigation attempted', 'Published article opened'] as const;
type TraceRow = { step: string; status: 'observed' | 'skipped' | 'failed'; reason: string };
const rows: TraceRow[] = [];
const transport: string[] = [];
export function traceTransport(reason: string): void {
  if (TRACE_READ_ONLY && transport.length < 24) transport.push(reason);
}
export function traceStep(index: number, status: TraceRow['status'], reason: string): void {
  if (!TRACE_READ_ONLY) return;
  rows[index] = { step: traceSteps[index], status, reason };
}
export function traceBlocked(reason: string): void {
  for (let index = 2; index < traceSteps.length; index++)
    if (!rows[index]) traceStep(index, 'skipped', reason);
}
export function publicationTrace() {
  return { build: BUILD_ID, version: chrome.runtime.getManifest().version, readOnly: TRACE_READ_ONLY, transport,
    steps: traceSteps.map((step, index) => rows[index] || { step, status: 'skipped', reason: TRACE_READ_ONLY ? 'Startup inspection still pending.' : 'This is the normal build; read-only startup trace was not enabled.' }) };
}
