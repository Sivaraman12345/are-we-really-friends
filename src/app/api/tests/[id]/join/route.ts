import { NextResponse } from "next/server";
import {
  getTest,
  createParticipantB,
  getParticipantsByTestId,
  logEvent,
} from "@/lib/db";
import { JoinTestRequestSchema } from "@/lib/types";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/tests/[id]/join
 *
 * Person B clicks the share link → this creates participant B.
 * Idempotent: if B already exists, returns the existing B.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: testId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const parsed = JoinTestRequestSchema.safeParse(body);

    const test = await getTest(testId);
    if (!test) {
      return NextResponse.json({ error: "Test not found" }, { status: 404 });
    }

    // Check if A has completed
    const participants = await getParticipantsByTestId(testId);
    const participantA = participants.find((p) => p.role === "A");

    if (!participantA || participantA.status !== "completed") {
      return NextResponse.json(
        { error: "Person A has not completed the test yet" },
        { status: 400 }
      );
    }

    // Create or return existing participant B (updating display name if provided)
    const displayName = parsed.success ? parsed.data.display_name : undefined;
    const participantB = await createParticipantB(testId, displayName);
    if (!participantB) {
      return NextResponse.json(
        { error: "Failed to create participant B" },
        { status: 500 }
      );
    }

    await logEvent("invite_accepted", testId, {
      participantId: participantB.id,
      role: "B",
    });

    return NextResponse.json({
      test_id: testId,
      participant_id: participantB.id,
      role: "B",
      display_name: participantB.display_name,
      status: participantB.status,
      total_scenarios: 8,
    });
  } catch (error) {
    console.error("Error joining test:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/tests/[id]/join
 *
 * Check the test status before joining (used by the /t/[id] page
 * to decide what screen to show).
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { id: testId } = await context.params;

    const test = await getTest(testId);
    if (!test) {
      return NextResponse.json({ error: "Test not found" }, { status: 404 });
    }

    const participants = await getParticipantsByTestId(testId);
    const participantA = participants.find((p) => p.role === "A");
    const participantB = participants.find((p) => p.role === "B");

    return NextResponse.json({
      test_id: testId,
      a_completed: participantA?.status === "completed",
      a_name: participantA?.display_name ?? null,
      b_exists: !!participantB,
      b_completed: participantB?.status === "completed",
      b_participant_id: participantB?.id ?? null,
      b_name: participantB?.display_name ?? null,
    });
  } catch (error) {
    console.error("Error checking test status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
