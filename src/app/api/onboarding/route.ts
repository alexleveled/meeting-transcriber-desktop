import { NextResponse } from "next/server";
import { getOnboardingSeen, setOnboardingSeen } from "@/server/settings";

export const dynamic = "force-dynamic";

/** Has the first-run welcome already been shown on this install? */
export function GET() {
  return NextResponse.json({ seen: getOnboardingSeen() });
}

/** Mark the first-run welcome as shown so it never appears again. */
export function POST() {
  setOnboardingSeen();
  return NextResponse.json({ seen: true });
}
