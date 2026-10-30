import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);

// Trusted server only. Reuse the installed SDK and its existing ADC file;
// the token travels over a private child-process pipe, never a command argument.
const refresh = String.raw`
import json, logging, os, sys
logging.disable(logging.CRITICAL)
sdk = sys.argv[1]
sys.path[:0] = [os.path.join(sdk, 'lib'), os.path.join(sdk, 'lib', 'third_party')]
try:
    from googlecloudsdk.core import config
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    import requests
    scope = 'https://www.googleapis.com/auth/spreadsheets'
    credentials = Credentials.from_authorized_user_file(config.ADCFilePath(), scopes=[scope])
    if credentials.token_uri != 'https://oauth2.googleapis.com/token':
        raise ValueError()
    credentials.refresh(Request())
    response = requests.post('https://oauth2.googleapis.com/tokeninfo',
        headers={'Authorization': 'Bearer ' + credentials.token}, timeout=10, allow_redirects=False)
    response.raise_for_status()
    info = response.json()
    if set(info.get('scope', '').split()) != {scope} or int(info.get('expires_in', 0)) <= 0:
        raise ValueError()
    sys.stdout.write(json.dumps({'accessToken': credentials.token}))
except BaseException:
    sys.exit(1)
`;

export async function getGoogleSheetsAccessToken({ env = process.env, platform = process.platform, run = runFile } = {}) {
  if (env.BA2_GOOGLE_SHEETS_ACCESS_TOKEN) return env.BA2_GOOGLE_SHEETS_ACCESS_TOKEN;
  if (platform !== "win32" || !env.LOCALAPPDATA) return "";
  const sdk = join(env.LOCALAPPDATA, "Google", "Cloud SDK", "google-cloud-sdk");
  try {
    const { stdout } = await run(join(sdk, "platform", "bundledpython", "python.exe"), ["-c", refresh, sdk], {
      env, windowsHide: true, timeout: 30_000, maxBuffer: 16_384,
    });
    const result = JSON.parse(stdout);
    return typeof result.accessToken === "string" ? result.accessToken : "";
  } catch {
    // Never propagate child output, exceptions or token-bearing diagnostics.
    return "";
  }
}
