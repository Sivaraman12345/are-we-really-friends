import { NextResponse } from "next/server";
import { LogEventRequestSchema } from "@/lib/types";
import { logEvent } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidUuid } from "@/lib/security";

/**
 * POST /api/events
 *
 * Generic analytics event recording endpoint.
 * Best-effort: catches errors so client flows are never interrupted.
 * Rate limited to 60 events per minute per IP.
 */
export async function POST(request: Request) {
  // Rate limit
  const rateLimitResponse = checkRateLimit(request, "log_events", {
    limit: 60,
    windowSeconds: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = LogEventRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid event data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { event_type, test_id, participant_id, role, metadata } = parsed.data;

    const validTestId = isValidUuid(test_id) ? test_id : null;
    const validParticipantId = isValidUuid(participant_id)
      ? participant_id
      : null;

    await logEvent(event_type, validTestId, {
      participantId: validParticipantId,
      role,
      metadata: metadata || null,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error logging generic event:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
