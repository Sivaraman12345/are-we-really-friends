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
      testId
    );

    // Log event
    await logEvent("test_started", test.id);

    return NextResponse.json(
      {
        test_id: test.id,
        participant_id: participant.id,
        role: "A",
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
