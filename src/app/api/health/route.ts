import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { getApiKey, getProvider } from "@/server/settings";

export const dynamic = "force-dynamic";

export function GET() {
  let dbOk = false;
  try {
    db.prepare("SELECT 1").get();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const activeProvider = getProvider();
  return NextResponse.json({
    ok: dbOk,
    dbOk,
    activeProvider,
    providerHasKey: !!getApiKey(activeProvider),
  });
}
