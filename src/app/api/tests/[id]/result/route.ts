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
import type { DimensionScores } from "@/lib/types";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidUuid } from "@/lib/security";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/tests/[id]/result
 *
 * Returns the comparison result once both A and B have completed.
 * If the comparison hasn't been computed yet, computes it now
 * (including the Gemini narrative call if configured).
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

    // Check for existing comparison
    let comparison = await getComparison(testId);

    if (!comparison) {
      // Compute the comparison
      const scoresA = participantA.dimension_scores as DimensionScores;
      const scoresB = participantB.dimension_scores as DimensionScores;

      const { bond_score, strongest_dimension, most_different_dimension } =
        computeComparison(scoresA, scoresB);

      // Generate narrative via Gemini (or fallback)
      const { friendship_type, narrative } = await generateResultNarrative(
        scoresA,
        scoresB,
        bond_score,
        strongest_dimension,
        most_different_dimension
      );

      comparison = {
        id: uuidv4(),
        test_id: testId,
        bond_score,
        strongest_dimension,
        most_different_dimension,
        friendship_type,
        narrative_summary: narrative,
        created_at: new Date().toISOString(),
      };

      await createComparison(comparison);
    }

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
