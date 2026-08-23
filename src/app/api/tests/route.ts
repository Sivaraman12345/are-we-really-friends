import { NextResponse } from "next/server";
import { CreateTestRequestSchema } from "@/lib/types";
import { createTest, logEvent } from "@/lib/db";
import { generateStorySeed } from "@/lib/scenarios";
import { v4 as uuidv4 } from "uuid";
import { checkRateLimit } from "@/lib/rate-limit";
import { sanitizeDisplayName, isValidUuid, buildUpdatedAuthCookie } from "@/lib/security";

/**
 * POST /api/tests
 * Create a new friendship test. Returns the test ID and participant A's ID.
 * Rate limited to 15 test creations per 10 minutes per IP.
 */
export async function POST(request: Request) {
  // Rate limit: 15 tests per 10 minutes
  const rateLimitResponse = await checkRateLimit(request, "create_test", {
    limit: 15,
    windowSeconds: 600,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = CreateTestRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const sanitizedName = sanitizeDisplayName(parsed.data.display_name);
    const parentTestId = isValidUuid(parsed.data.parent_test_id)
      ? parsed.data.parent_test_id
      : null;
    const createdByParticipantId = isValidUuid(
      parsed.data.created_by_participant_id
    )
      ? parsed.data.created_by_participant_id
      : null;

    // Generate a test ID first, then use it to seed the story
    const testId = uuidv4();
    const storySeed = generateStorySeed(testId);

    const { test, participant } = await createTest(
      parsed.data.relationship_type,
      storySeed,
      sanitizedName || undefined,
      testId,
      parentTestId,
      createdByParticipantId
    );

    // Log event based on whether this is a root test or child test in a viral chain
    if (test.parent_test_id) {
      await logEvent("new_test_created", test.id, {
        participantId: participant.id,
        role: "A",
        metadata: {
          parent_test_id: test.parent_test_id,
          created_by_participant_id: test.created_by_participant_id,
          root_test_id: test.root_test_id,
          generation_depth: test.generation_depth,
        },
      });
    } else {
      await logEvent("test_created", test.id, {
        participantId: participant.id,
        role: "A",
        metadata: {
          root_test_id: test.root_test_id,
          generation_depth: 0,
        },
      });
    }

    const cookieHeader = request.headers.get("cookie");
    const setCookie = buildUpdatedAuthCookie(
      test.id,
      participant.id,
      participant.session_token || participant.id,
      "A",
      cookieHeader
    );

    const response = NextResponse.json(
      {
        test_id: test.id,
        participant_id: participant.id,
        session_token: participant.session_token,
        role: "A",
        display_name: participant.display_name,
        parent_test_id: test.parent_test_id,
        root_test_id: test.root_test_id,
        generation_depth: test.generation_depth,
        total_scenarios: 8,
      },
      { status: 201 }
    );

    response.headers.set("Set-Cookie", setCookie);
    return response;
  } catch (error) {
    console.error("Error creating test:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
