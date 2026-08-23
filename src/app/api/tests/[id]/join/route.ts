import { NextResponse } from "next/server";
import {
  getTest,
  createParticipantB,
  getParticipantsByTestId,
  logEvent,
} from "@/lib/db";
import { JoinTestRequestSchema } from "@/lib/types";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidUuid, sanitizeDisplayName } from "@/lib/security";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/tests/[id]/join
 *
 * Person B clicks the share link → this creates participant B.
 * Idempotent: if B already exists, returns the existing B.
 * Rate limited to 20 requests per 10 minutes per IP.
 */
export async function POST(request: Request, context: RouteContext) {
  // Rate limit
  const rateLimitResponse = checkRateLimit(request, "join_test", {
    limit: 20,
    windowSeconds: 600,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id: testId } = await context.params;

    if (!isValidUuid(testId)) {
      return NextResponse.json({ error: "Invalid test ID" }, { status: 400 });
    }

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
    const displayName = parsed.success
      ? sanitizeDisplayName(parsed.data.display_name)
      : null;
    const participantB = await createParticipantB(
      testId,
      displayName || undefined
    );
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
  // Rate limit
  const rateLimitResponse = checkRateLimit(request, "get_join_status", {
    limit: 60,
    windowSeconds: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id: testId } = await context.params;

    if (!isValidUuid(testId)) {
      return NextResponse.json({ error: "Invalid test ID" }, { status: 400 });
    }

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
