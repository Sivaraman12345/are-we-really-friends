import { NextResponse } from "next/server";
import { getParticipant } from "@/lib/db";

type RouteContext = { params: Promise<{ pid: string }> };

/**
 * GET /api/participants/[pid]
 *
 * Lightweight lookup so the play page can recover testId
 * after a browser refresh (sessionStorage may be empty).
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { pid } = await context.params;

    const participant = await getParticipant(pid);
    if (!participant) {
      return NextResponse.json(
        { error: "Participant not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      participant_id: participant.id,
      test_id: participant.test_id,
      role: participant.role,
      display_name: participant.display_name,
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
