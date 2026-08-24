import { NextResponse } from "next/server";
import { SubmitChoiceRequestSchema, TOTAL_SCENARIOS } from "@/lib/types";
import {
  getTest,
  getParticipant,
  getScenarioInstances,
  updateScenarioChoice,
  updateParticipantScores,
  logEvent,
} from "@/lib/db";
import { initRawScores, accumulateScores, normalizeScores } from "@/lib/scoring";
import { computeScoringBounds } from "@/lib/scenarios";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidUuid, isRequestAuthorizedForParticipant } from "@/lib/security";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/tests/[id]/choice
 *
 * Submit a choice for a scenario. When all 8 are done,
 * auto-computes and stores normalized dimension scores.
 * Rate limited to 60 requests per minute per IP.
 */
export async function POST(request: Request, context: RouteContext) {
  // Rate limit
  const rateLimitResponse = await checkRateLimit(request, "submit_choice", {
    limit: 60,
    windowSeconds: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id: testId } = await context.params;

    if (!isValidUuid(testId)) {
      return NextResponse.json({ error: "Invalid test ID" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = SubmitChoiceRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { participant_id, scenario_index, chosen_option } = parsed.data;

    // Validate test and participant
    const test = await getTest(testId);
    if (!test) {
      return NextResponse.json({ error: "Test not found" }, { status: 404 });
    }

    const participant = await getParticipant(participant_id);
    if (!participant || participant.test_id !== testId) {
      return NextResponse.json(
        { error: "Participant not found for this test" },
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

    if (participant.status === "completed") {
      return NextResponse.json(
        { error: "Participant has already completed all scenarios" },
        { status: 400 }
      );
    }

    // Find the scenario instances for this participant
    const instances = await getScenarioInstances(participant_id);
    const priorCompletedCount = instances.filter(
      (i) => i.chosen_option !== null
    ).length;

    // Strict sequential check: prevent skipping scenarios
    if (scenario_index !== priorCompletedCount) {
      return NextResponse.json(
        { error: "Scenarios must be completed in sequential order" },
        { status: 400 }
      );
    }

    const instance = instances.find(
      (i) => i.sequence_index === scenario_index
    );

    if (!instance) {
      return NextResponse.json(
        { error: `No scenario instance found for index ${scenario_index}` },
        { status: 404 }
      );
    }

    // Record the choice atomically (prevents concurrent or duplicate submissions)
    const updatedInstance = await updateScenarioChoice(instance.id, chosen_option);
    if (!updatedInstance) {
      return NextResponse.json(
        { error: "Choice already submitted for this scenario" },
        { status: 400 }
      );
    }

    // Emit started events on first choice submission
    if (scenario_index === 0) {
      if (participant.role === "A") {
        await logEvent("creator_started", testId, {
          participantId: participant.id,
          role: "A",
        });
      } else {
        await logEvent("friend_started", testId, {
          participantId: participant.id,
          role: "B",
        });
      }
    }

    // Re-fetch all instances to compute progress
    const updatedInstances = await getScenarioInstances(participant_id);
    const completedCount = updatedInstances.filter(
      (i) => i.chosen_option !== null
    ).length;
    const allDone = completedCount >= TOTAL_SCENARIOS;

    let normalized = null;

    if (allDone) {
      // Accumulate all raw scores
      let rawScores = initRawScores();
      for (const inst of updatedInstances) {
        if (inst.chosen_option) {
          const choice = inst.rendered_scenario.choices.find(
            (c) => c.id === inst.chosen_option
          );
          if (choice) {
            rawScores = accumulateScores(rawScores, choice.scores);
          }
        }
      }

      // Compute bounds from this test's specific slot sequence
      const bounds = computeScoringBounds(test.story_seed.slot_ids);

      // Normalize to 0-100
      normalized = normalizeScores(rawScores, bounds);

      // Persist
      await updateParticipantScores(participant_id, normalized);

      // Emit completion events
      if (participant.role === "A") {
        await logEvent("creator_completed", testId, {
          participantId: participant.id,
          role: "A",
        });
      } else {
        await logEvent("friend_completed", testId, {
          participantId: participant.id,
          role: "B",
        });
      }
    }

    return NextResponse.json({
      success: true,
      completed_count: completedCount,
      total_scenarios: TOTAL_SCENARIOS,
      all_done: allDone,
      ...(allDone && { dimension_scores: normalized }),
    });
  } catch (error) {
    console.error("Error submitting choice:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
