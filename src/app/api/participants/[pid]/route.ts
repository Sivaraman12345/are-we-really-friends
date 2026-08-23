import { NextResponse } from "next/server";
import { getParticipant } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidUuid, isRequestAuthorizedForParticipant } from "@/lib/security";

type RouteContext = { params: Promise<{ pid: string }> };

/**
 * GET /api/participants/[pid]
 *
 * Lightweight lookup so the play page can recover testId
 * after a browser refresh (sessionStorage may be empty).
 * Rate limited to 120 requests per minute per IP.
 */
export async function GET(request: Request, context: RouteContext) {
  // Rate limit
  const rateLimitResponse = await checkRateLimit(request, "get_participant", {
    limit: 120,
    windowSeconds: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { pid } = await context.params;

    if (!isValidUuid(pid)) {
      return NextResponse.json(
        { error: "Invalid participant ID" },
        { status: 400 }
      );
    }

    const participant = await getParticipant(pid);
    if (!participant) {
      return NextResponse.json(
        { error: "Participant not found" },
        { status: 404 }
      );
    }

    // IDOR protection: Verify participant session token via header, query, or secure cookie
    if (!isRequestAuthorizedForParticipant(request, participant)) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid participant session" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      participant_id: participant.id,
      test_id: participant.test_id,
      role: participant.role,
      display_name: participant.display_name,
      session_token: participant.session_token,
      status: participant.status,
    });
  } catch (error) {
    console.error("Error fetching participant:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
