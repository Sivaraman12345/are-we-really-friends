import {
  DIMENSIONS,
  type Dimension,
  type DimensionScores,
  type RawScores,
  type ScoreMap,
  type ScoringBounds,
} from "./types";

// ── Initialize Raw Scores ───────────────────────────────────────────
/** Create a zeroed-out raw score map for all dimensions */
export function initRawScores(): RawScores {
  const scores: Partial<RawScores> = {};
  for (const dim of DIMENSIONS) {
    scores[dim] = 0;
  }
  return scores as RawScores;
}

// ── Accumulate Scores ───────────────────────────────────────────────
/** Add a choice's score deltas to the running raw scores */
export function accumulateScores(
  current: RawScores,
  choiceScores: ScoreMap
): RawScores {
  const updated = { ...current };
  for (const [dim, delta] of Object.entries(choiceScores)) {
    const dimension = dim as Dimension;
    updated[dimension] = (updated[dimension] ?? 0) + delta;
  }
  return updated;
}

// ── Normalize Scores ────────────────────────────────────────────────
/**
 * Map raw accumulated scores to [0, 100] using the actual scoring
 * bounds for this test's specific slot sequence.
 *
 * The bounds are computed programmatically from the template set
 * in scenarios.ts — never hardcoded.
 */
export function normalizeScores(
  rawScores: RawScores,
  bounds: ScoringBounds
): DimensionScores {
  const result: Partial<DimensionScores> = {};

  for (const dim of DIMENSIONS) {
    const raw = rawScores[dim] ?? 0;
    const max = bounds.maxPerDim[dim];
    const min = bounds.minPerDim[dim];
    const range = max - min;

    if (range === 0) {
      // Dimension is never scored in this test — give a neutral 50
      result[dim] = 50;
    } else {
      const normalized = Math.round(((raw - min) / range) * 100);
      result[dim] = Math.max(0, Math.min(100, normalized));
    }
  }

  return result as DimensionScores;
}

// ── Bond Score ──────────────────────────────────────────────────────
/**
 * Compute how similar two participants' scores are.
 *
 * Formula: 100 - avg(|A_dim - B_dim|) for each dimension
 *
 * A bond score of 100 means identical scores across all dimensions.
 * A bond score of 0 means maximum difference (100 pts apart on every dim).
 */
export function computeBondScore(
  scoresA: DimensionScores,
  scoresB: DimensionScores
): number {
  let totalDiff = 0;
  for (const dim of DIMENSIONS) {
    totalDiff += Math.abs((scoresA[dim] ?? 50) - (scoresB[dim] ?? 50));
  }
  const avgDiff = totalDiff / DIMENSIONS.length;
  return Math.max(0, Math.round(100 - avgDiff));
}

// ── Find Strongest & Most Different Dimensions ─────────────────────
export function findDimensionExtremes(
  scoresA: DimensionScores,
  scoresB: DimensionScores
): { strongest: Dimension; mostDifferent: Dimension } {
  let minDiff = Infinity;
  let maxDiff = -Infinity;
  let strongest: Dimension = "trust";
  let mostDifferent: Dimension = "trust";

  for (const dim of DIMENSIONS) {
    const diff = Math.abs((scoresA[dim] ?? 50) - (scoresB[dim] ?? 50));
    const avg = ((scoresA[dim] ?? 50) + (scoresB[dim] ?? 50)) / 2;

    // For "strongest", prefer dimensions where both score HIGH and similarly
    if (
      diff < minDiff ||
      (diff === minDiff &&
        avg >
          ((scoresA[strongest] ?? 50) + (scoresB[strongest] ?? 50)) / 2)
    ) {
      minDiff = diff;
      strongest = dim;
    }

    if (diff > maxDiff) {
      maxDiff = diff;
      mostDifferent = dim;
    }
  }

  return { strongest, mostDifferent };
}

// ── Compute Full Comparison ─────────────────────────────────────────
export function computeComparison(
  scoresA: DimensionScores,
  scoresB: DimensionScores
): {
  bond_score: number;
  strongest_dimension: Dimension;
  most_different_dimension: Dimension;
} {
  const bond_score = computeBondScore(scoresA, scoresB);
  const { strongest, mostDifferent } = findDimensionExtremes(scoresA, scoresB);

  return {
    bond_score,
    strongest_dimension: strongest,
    most_different_dimension: mostDifferent,
  };
}
