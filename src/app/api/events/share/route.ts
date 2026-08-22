import { NextResponse } from "next/server";
import { logEvent } from "@/lib/db";

/**
 * POST /api/events/share
 *
 * Logs a share event. Increment counter used to decide
 * when to enable ad monetisation (SHARE_THRESHOLD_FOR_ADS).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const testId = body.test_id;

    if (!testId || typeof testId !== "string") {
      return NextResponse.json(
        { error: "test_id is required" },
        { status: 400 }
      );
    }

    await logEvent("result_shared", testId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error logging share event:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
