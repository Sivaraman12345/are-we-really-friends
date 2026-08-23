import { NextResponse } from "next/server";
import { LogEventRequestSchema } from "@/lib/types";
import { logEvent } from "@/lib/db";

/**
 * POST /api/events
 *
 * Generic analytics event recording endpoint.
 * Best-effort: catches errors so client flows are never interrupted.
 */
export async function POST(request: Request) {
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

    await logEvent(event_type, test_id, {
      participantId: participant_id,
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
