import { timingSafeEqual } from "node:crypto";
import { writeVerifiedListingToSheet } from "../../../playwright-worker/ampblogs/sheets.mjs";
import { getGoogleSheetsAccessToken } from "../../../playwright-worker/ampblogs/google-credentials.mjs";
import { validateAmpBlogsProfile } from "../../../playwright-worker/ampblogs/profile.mjs";
import { publicArticleUrl } from "../../../extension/src/automation/verification.ts";

type BackendOptions = { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch };
let sheetQueue: Promise<unknown> = Promise.resolve();

function authorized(request: Request, env: NodeJS.ProcessEnv): boolean {
  const key = env.BA2_SHEETS_WRITEBACK_KEY;
  const supplied = request.headers.get("x-ba2-sheets-key");
  const id = env.BA2_SHEETS_EXTENSION_ID;
  return Boolean(id && /^[a-p]{32}$/.test(id) && request.headers.get("origin") === `chrome-extension://${id}`
    && ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname)
    && key && key.length >= 32 && supplied && Buffer.byteLength(key) === Buffer.byteLength(supplied)
    && timingSafeEqual(Buffer.from(key), Buffer.from(supplied)));
}

export function sheetsCors(request: Request, env = process.env): HeadersInit {
  const origin = request.headers.get("origin");
  return env.BA2_SHEETS_EXTENSION_ID && origin === `chrome-extension://${env.BA2_SHEETS_EXTENSION_ID}`
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, x-ba2-sheets-key", vary: "Origin" } : {};
}

export async function handleSheetsWriteBack(request: Request, { env = process.env, fetchImpl = fetch }: BackendOptions = {}): Promise<Response> {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...sheetsCors(request, env), "cache-control": "no-store" } });
  if (!authorized(request, env)) return reply({ status: "blocked", code: "backend-authorization-required", reason: "Trusted extension/backend authorization must be configured before Sheets synchronization." }, 403);
  const prepareOnly = new URL(request.url).searchParams.get("mode") === "prepare";
  if (!prepareOnly && env.BA2_SHEETS_WRITE_APPROVED !== "true") return reply({ status: "blocked", code: "write-approval-required", reason: "The operator must separately approve Google Sheets write access. No write attempted." });
  try {
    if (Number(request.headers.get("content-length")) > 8192) return reply({ status: "blocked", code: "invalid-request", reason: "Synchronization request is too large." }, 400);
    const text = await request.text();
    if (text.length > 8192) return reply({ status: "blocked", code: "invalid-request", reason: "Synchronization request is too large." }, 400);
    const input = JSON.parse(text);
    const checkedAt = Date.parse(input?.verification?.checkedAt);
    if (!validateAmpBlogsProfile({ businessName: input?.businessName }).ok || input?.publicationAuthorized !== true
      || input?.verification?.status !== "verified" || typeof input.liveUrl !== "string" || input.verification.url !== input.liveUrl
      || publicArticleUrl(input.liveUrl, input.websiteUrl) !== input.liveUrl || !Number.isFinite(checkedAt)
      || Date.now() - checkedAt > 60_000 || checkedAt > Date.now() + 5_000) {
      return reply({ status: "blocked", code: "verification-required", reason: "A current verified article from an authorized publication for the original business is required." });
    }
    // Serialize local requests to this one fixed sheet; no browser or worker is started.
    const operation = sheetQueue.catch(() => undefined).then(async () => writeVerifiedListingToSheet(input, {
      accessToken: await getGoogleSheetsAccessToken({ env }), writeApproved: !prepareOnly, prepareOnly, fetchImpl,
    }));
    sheetQueue = operation;
    return reply(await operation);
  } catch {
    return reply({ status: "blocked", code: "invalid-request", reason: "Synchronization could not be validated. No automatic retry." }, 400);
  }
}
