import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  getTest,
  getParticipantsByTestId,
  getComparison,
  createComparison,
} from "@/lib/db";
import { computeComparison } from "@/lib/scoring";
import { generateResultNarrative } from "@/lib/gemini";
import type { Comparison, DimensionScores } from "@/lib/types";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidUuid } from "@/lib/security";

type RouteContext = { params: Promise<{ id: string }> };

// In-memory promise map to deduplicate concurrent first result requests for the same test
const inFlightResultGenerations = new Map<string, Promise<Comparison>>();

async function getOrCreateComparison(
  testId: string,
  scoresA: DimensionScores,
  scoresB: DimensionScores
): Promise<Comparison> {
  // Check if comparison already exists in DB
  const existing = await getComparison(testId);
  if (existing) return existing;

  // Check if generation is already in-flight for this test
  const inFlight = inFlightResultGenerations.get(testId);
  if (inFlight) {
    return inFlight;
  }

  // Create a single generation promise for all concurrent callers
  const generationPromise = (async () => {
    try {
      // 1. Calculate deterministic comparison metrics first
      const { bond_score, strongest_dimension, most_different_dimension } =
        computeComparison(scoresA, scoresB);

      // 2. Generate AI narrative (falls back to deterministic template on timeout/error)
      const { friendship_type, narrative } = await generateResultNarrative(
        scoresA,
        scoresB,
        bond_score,
        strongest_dimension,
        most_different_dimension
      );

      const comparison: Comparison = {
        id: uuidv4(),
        test_id: testId,
        bond_score,
        strongest_dimension,
        most_different_dimension,
        friendship_type,
        narrative_summary: narrative,
        created_at: new Date().toISOString(),
      };

      // 3. Persist comparison to DB
      await createComparison(comparison);
      return comparison;
    } finally {
      inFlightResultGenerations.delete(testId);
    }
  })();

  inFlightResultGenerations.set(testId, generationPromise);
  return generationPromise;
}

/**
 * GET /api/tests/[id]/result
 *
 * Returns the comparison result once both A and B have completed.
 * If the comparison hasn't been computed yet, computes it once,
 * stores it permanently, and returns it.
 * Rate limited to 30 requests per minute per IP.
 */
export async function GET(request: Request, context: RouteContext) {
  // Rate limit
  const rateLimitResponse = checkRateLimit(request, "get_result", {
    limit: 30,
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

    if (
      !participantA ||
      participantA.status !== "completed" ||
      !participantA.dimension_scores ||
      !participantB ||
      participantB.status !== "completed" ||
      !participantB.dimension_scores
    ) {
      return NextResponse.json(
        {
          error: "Both participants must complete the test first",
          a_completed: participantA?.status === "completed",
          b_completed: participantB?.status === "completed",
        },
        { status: 400 }
      );
    }

    const scoresA = participantA.dimension_scores as DimensionScores;
    const scoresB = participantB.dimension_scores as DimensionScores;

    // Get existing comparison or compute it exactly once
    const comparison = await getOrCreateComparison(testId, scoresA, scoresB);

    return NextResponse.json({
      test_id: testId,
      bond_score: comparison.bond_score,
      strongest_dimension: comparison.strongest_dimension,
      most_different_dimension: comparison.most_different_dimension,
      friendship_type: comparison.friendship_type,
      narrative: comparison.narrative_summary,
      names: {
        a: participantA.display_name ?? null,
        b: participantB.display_name ?? null,
      },
      scores: {
        a: participantA.dimension_scores,
        b: participantB.dimension_scores,
      },
    });
  } catch (error) {
    console.error("Error computing result:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
