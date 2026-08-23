import { NextResponse } from "next/server";
import { logEvent } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidUuid } from "@/lib/security";

/**
 * POST /api/events/share
 *
 * Logs a share event. Increment counter used to decide
 * when to enable ad monetisation (SHARE_THRESHOLD_FOR_ADS).
 * Rate limited to 60 requests per minute per IP.
 */
export async function POST(request: Request) {
  // Rate limit
  const rateLimitResponse = await checkRateLimit(request, "share_event", {
    limit: 60,
    windowSeconds: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json().catch(() => ({}));
    const { test_id: testId, participant_id: participantId, role } = body;

    if (!testId || !isValidUuid(testId)) {
      return NextResponse.json(
        { error: "Valid test_id is required" },
        { status: 400 }
      );
    }

    const validParticipantId = isValidUuid(participantId)
      ? participantId
      : null;

    await logEvent("result_shared", testId, {
      participantId: validParticipantId,
      role: role === "A" || role === "B" ? role : null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error logging share event:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
