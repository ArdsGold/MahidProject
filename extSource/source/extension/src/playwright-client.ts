const PLAYWRIGHT_BRIDGE_URL = "http://127.0.0.1:3210";
const PLAYWRIGHT_BRIDGE_TOKEN = "ba2-playwright-local-token";

export interface PlaywrightSelectInspection {
  found: boolean;
  name?: string;
  id?: string;
  currentValue?: string;
  currentText?: string;
  optionCount?: number;
  options?: { text: string; value: string }[];
  selector?: string;
}

export interface PlaywrightFieldInspection {
  found: boolean;
  type?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  associatedLabel?: string;
  nearbyContext?: string;
  valueExists?: boolean;
  selector?: string;
}

export interface PlaywrightFieldVerification {
  found: boolean;
  verified: boolean;
  currentValue?: string;
  currentText?: string;
  valueMatches?: boolean;
  textMatches?: boolean;
  selector?: string;
}

export function recordPlaywrightDiagnostic(stage: string, details: Record<string, unknown>): void {
  void request("/diagnostics", { stage, details }).catch(() => undefined);
}

async function request<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${PLAYWRIGHT_BRIDGE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ba2-playwright-token": PLAYWRIGHT_BRIDGE_TOKEN },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error || `Playwright bridge returned HTTP ${response.status}.`);
    return result;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function inspectSelect(selector: string, url = location.href): Promise<PlaywrightSelectInspection> {
  return request("/inspect-select", { selector, url });
}

export function inspectField(selector: string, url = location.href): Promise<PlaywrightFieldInspection> {
  return request("/inspect-field", { selector, url });
}

export function verifyField(selector: string, expectedValue?: string, expectedText?: string, url = location.href): Promise<PlaywrightFieldVerification> {
  return request("/verify-field", { selector, expectedValue, expectedText, url });
}
