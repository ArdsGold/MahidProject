import { NextResponse } from "next/server";
import { gatherBusinessSources, type GatherSources } from "@/lib/source-gatherer";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Partial<GatherSources>;
    const result = await gatherBusinessSources({ gmbUrl: body.gmbUrl ?? "", websiteUrl: body.websiteUrl ?? "" });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gathering failed." }, { status: 400 });
  }
}
