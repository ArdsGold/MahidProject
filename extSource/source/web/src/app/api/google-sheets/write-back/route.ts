import { handleSheetsWriteBack, sheetsCors } from "../../../../lib/sheets-writeback";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleSheetsWriteBack(request);
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: sheetsCors(request) });
}
