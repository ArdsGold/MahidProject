const AMP_BLOGS_WORKER_URL = "http://127.0.0.1:3210";
const AMP_BLOGS_WORKER_TOKEN = "ba2-playwright-local-token";

export interface AmpBlogsPreflightResponse {
  ok: boolean;
  status?: "blocked" | "needs-human" | "in-progress";
  message?: string;
  error?: string;
  run?: { runId: string; state: string; reason?: string; steps?: string[]; manual?: string[] };
  sheet?: { status?: string; code?: string; reason?: string; setupPlan?: string[]; row?: { directoryUrl: string; existingListingUrl: string; existingStatus: string } };
  observations?: unknown;
}

export async function startAmpBlogsPreflight(profile: { profileId: string; businessName: string }): Promise<AmpBlogsPreflightResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${AMP_BLOGS_WORKER_URL}/ampblogs/preflight`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ba2-playwright-token": AMP_BLOGS_WORKER_TOKEN },
      body: JSON.stringify({ profile }),
      signal: controller.signal,
    });
    const result = await response.json() as AmpBlogsPreflightResponse;
    if (!response.ok) return { ok: false, error: result.error || `AmpBlogs preflight worker returned HTTP ${response.status}.` };
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "AmpBlogs preflight worker is unavailable." };
  } finally {
    clearTimeout(timeout);
  }
}
