import { NextResponse } from "next/server";
import { getTest, getParticipant, getScenarioInstances, createScenarioInstance } from "@/lib/db";
import { renderScenario, computeTendency, defaultTendency } from "@/lib/scenarios";
import { initRawScores, accumulateScores } from "@/lib/scoring";
import type { RawScores, Tendency } from "@/lib/types";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidUuid } from "@/lib/security";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/tests/[id]/next-scenario?participant_id=xxx
 *
 * Returns the next scenario for a participant based on their progress
 * and running tendency signal.
 * Rate limited to 120 requests per minute per IP.
 */
export async function GET(request: Request, context: RouteContext) {
  // Rate limit
  const rateLimitResponse = checkRateLimit(request, "next_scenario", {
    limit: 120,
    windowSeconds: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id: testId } = await context.params;

    if (!isValidUuid(testId)) {
      return NextResponse.json({ error: "Invalid test ID" }, { status: 400 });
    }

    const url = new URL(request.url);
    const participantId = url.searchParams.get("participant_id");

    if (!participantId || !isValidUuid(participantId)) {
      return NextResponse.json(
        { error: "Valid participant_id query parameter is required" },
        { status: 400 }
      );
    }

    // Load test and participant
    const test = await getTest(testId);
    if (!test) {
      return NextResponse.json({ error: "Test not found" }, { status: 404 });
    }

    const participant = await getParticipant(participantId);
    if (!participant || participant.test_id !== testId) {
      return NextResponse.json(
        { error: "Participant not found for this test" },
        { status: 404 }
      );
    }

    if (participant.status === "completed") {
      return NextResponse.json(
        { error: "Participant has already completed all scenarios", completed: true },
        { status: 200 }
      );
    }

    // Load existing scenario instances to determine progress
    const instances = await getScenarioInstances(participantId);
    const completedCount = instances.filter((i) => i.chosen_option !== null).length;
    const nextIndex = completedCount;

    if (nextIndex >= 8) {
      return NextResponse.json(
        { error: "All scenarios completed", completed: true },
        { status: 200 }
      );
    }

    // Check if there's already a pending (unanswered) scenario
    const pending = instances.find((i) => i.chosen_option === null);
    if (pending) {
      return NextResponse.json({
        scenario_instance_id: pending.id,
        scenario_index: pending.sequence_index,
        total_scenarios: 8,
        scenario: {
          theme: pending.rendered_scenario.theme,
          situation: pending.rendered_scenario.situation,
          choices: pending.rendered_scenario.choices.map((c) => ({
            id: c.id,
            text: c.text,
          })),
        },
      });
    }

    // Compute tendency from accumulated scores
    let rawScores: RawScores = initRawScores();
    for (const inst of instances) {
      if (inst.chosen_option) {
        const choice = inst.rendered_scenario.choices.find(
          (c) => c.id === inst.chosen_option
        );
        if (choice) {
          rawScores = accumulateScores(rawScores, choice.scores);
        }
      }
    }

    const fallback: Tendency = defaultTendency(testId);
    const tendency = completedCount === 0 ? fallback : computeTendency(rawScores, fallback);

    // Render the next scenario using tendency-based variant selection
    const { rendered, slotId, variantId } = renderScenario(
      test.story_seed,
      nextIndex,
      tendency
    );

    // Store the scenario instance
    const instance = await createScenarioInstance(
      participantId,
      nextIndex,
      slotId,
      variantId,
      rendered
    );

    return NextResponse.json({
      scenario_instance_id: instance.id,
      scenario_index: nextIndex,
      total_scenarios: 8,
      scenario: {
        theme: rendered.theme,
        situation: rendered.situation,
        choices: rendered.choices.map((c) => ({
          id: c.id,
          text: c.text,
          // Scores are NOT sent to the client — deterministic scoring is server-side only
        })),
      },
    });
  } catch (error) {
    console.error("Error fetching next scenario:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
