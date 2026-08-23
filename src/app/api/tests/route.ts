import { NextResponse } from "next/server";
import { CreateTestRequestSchema } from "@/lib/types";
import { createTest } from "@/lib/db";
import { generateStorySeed } from "@/lib/scenarios";
import { v4 as uuidv4 } from "uuid";
import { logEvent } from "@/lib/db";

/**
 * POST /api/tests
 * Create a new friendship test. Returns the test ID and participant A's ID.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = CreateTestRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Generate a test ID first, then use it to seed the story
    const testId = uuidv4();
    const storySeed = generateStorySeed(testId);

    const { test, participant } = await createTest(
      parsed.data.relationship_type,
      storySeed,
      parsed.data.display_name,
      testId,
      parsed.data.parent_test_id,
      parsed.data.created_by_participant_id
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

    return NextResponse.json(
      {
        test_id: test.id,
        participant_id: participant.id,
        role: "A",
        display_name: participant.display_name,
        parent_test_id: test.parent_test_id,
        root_test_id: test.root_test_id,
        generation_depth: test.generation_depth,
        total_scenarios: 8,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating test:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
