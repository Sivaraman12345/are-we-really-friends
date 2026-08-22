import slotData from "@/data/templates.json";
import {
  DIMENSIONS,
  TOTAL_SCENARIOS,
  type Dimension,
  type StorySeed,
  type SlotTemplate,
  type RenderedScenario,
  type RawScores,
  type Tendency,
  type ScoringBounds,
  type SlotScores,
  SlotTemplateSchema,
} from "./types";

// ── Load & Validate All Slots ───────────────────────────────────────
const ALL_SLOTS: SlotTemplate[] = slotData.map((raw) =>
  SlotTemplateSchema.parse(raw)
);

// Index by theme for fast lookup during seed generation
const slotsByTheme: Map<Dimension, SlotTemplate[]> = new Map();
for (const dim of DIMENSIONS) {
  slotsByTheme.set(dim, []);
}
for (const slot of ALL_SLOTS) {
  slotsByTheme.get(slot.theme)!.push(slot);
}

// ── Seeded PRNG (mulberry32) ────────────────────────────────────────
function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uuidToSeed(uuid: string): number {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    const char = uuid.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

// ── Story Seed Generation ───────────────────────────────────────────
/**
 * Generate a story seed for a new test.
 *
 * Picks one slot per dimension (7), plus one extra from a random
 * dimension = 8 slots. The slots are shuffled so the theme order
 * varies across tests. The seed is deterministic given the testId.
 */
export function generateStorySeed(testId: string): StorySeed {
  const rng = mulberry32(uuidToSeed(testId));

  // Shuffle dimensions for ordering
  const shuffledDims = [...DIMENSIONS];
  for (let i = shuffledDims.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffledDims[i], shuffledDims[j]] = [shuffledDims[j], shuffledDims[i]];
  }

  // 7 dimensions + 1 extra = 8 scenarios
  const extraDim = shuffledDims[Math.floor(rng() * shuffledDims.length)];
  const themeSequence: Dimension[] = [...shuffledDims, extraDim];

  // Select one slot per theme position
  const slotIds: string[] = [];
  const usedSlotIds = new Set<string>();

  for (const theme of themeSequence) {
    const available = (slotsByTheme.get(theme) ?? []).filter(
      (s) => !usedSlotIds.has(s.slot_id)
    );

    if (available.length === 0) {
      // Fallback: reuse a slot from this theme if all are taken
      const allForTheme = slotsByTheme.get(theme) ?? [];
      const selected = allForTheme[Math.floor(rng() * allForTheme.length)];
      slotIds.push(selected.slot_id);
    } else {
      const selected = available[Math.floor(rng() * available.length)];
      usedSlotIds.add(selected.slot_id);
      slotIds.push(selected.slot_id);
    }
  }

  return {
    theme_sequence: themeSequence,
    slot_ids: slotIds,
  };
}

// ── Tendency Signal ─────────────────────────────────────────────────
/**
 * Compute the player's running tendency from their accumulated scores.
 *
 * "bold"       → biased toward adventure + trust + humor
 * "thoughtful" → biased toward empathy + communication + loyalty
 *
 * When scores are tied or empty, `fallback` is returned
 * (seeded from the test ID so it's deterministic).
 */
export function computeTendency(
  rawScores: RawScores,
  fallback: Tendency
): Tendency {
  const boldSignal =
    (rawScores.adventure ?? 0) +
    (rawScores.trust ?? 0) +
    (rawScores.humor ?? 0);
  const thoughtfulSignal =
    (rawScores.empathy ?? 0) +
    (rawScores.communication ?? 0) +
    (rawScores.loyalty ?? 0);

  if (boldSignal > thoughtfulSignal) return "bold";
  if (thoughtfulSignal > boldSignal) return "thoughtful";
  return fallback;
}

/**
 * Determine the default tendency for a test (used as tie-breaker
 * and for the first scenario when there's no history).
 */
export function defaultTendency(testId: string): Tendency {
  const seed = uuidToSeed(testId);
  return seed % 2 === 0 ? "bold" : "thoughtful";
}

// ── Variant Selection ───────────────────────────────────────────────
/**
 * Given a slot and a tendency, pick the matching variant.
 * Falls back to the first variant if no match exists.
 */
function selectVariant(
  slot: SlotTemplate,
  tendency: Tendency
): (typeof slot.variants)[number] {
  const match = slot.variants.find((v) => v.tendency === tendency);
  return match ?? slot.variants[0];
}

// ── Render Scenario ─────────────────────────────────────────────────
/**
 * Given a story seed, a scenario index, and the player's current
 * tendency, render the full scenario (combining slot scores with
 * variant narrative text).
 */
export function renderScenario(
  seed: StorySeed,
  index: number,
  tendency: Tendency
): { rendered: RenderedScenario; slotId: string; variantId: string } {
  if (index < 0 || index >= TOTAL_SCENARIOS) {
    throw new Error(
      `Invalid scenario index: ${index}. Must be 0–${TOTAL_SCENARIOS - 1}`
    );
  }

  const slotId = seed.slot_ids[index];
  const slot = ALL_SLOTS.find((s) => s.slot_id === slotId);
  if (!slot) {
    throw new Error(`Slot not found: ${slotId}`);
  }

  const variant = selectVariant(slot, tendency);

  const rendered: RenderedScenario = {
    theme: slot.theme,
    situation: variant.situation,
    choices: [
      {
        id: "A",
        text: variant.choice_texts.A,
        scores: slot.scores.A,
      },
      {
        id: "B",
        text: variant.choice_texts.B,
        scores: slot.scores.B,
      },
      {
        id: "C",
        text: variant.choice_texts.C,
        scores: slot.scores.C,
      },
    ],
  };

  return { rendered, slotId: slot.slot_id, variantId: variant.id };
}

// ── Programmatic Scoring Bounds ─────────────────────────────────────
/**
 * Compute the actual max_possible and min_possible per dimension
 * for a specific test, based on the slots in its story seed.
 *
 * This replaces the old hardcoded constants. For each slot in
 * the sequence, we look at what the best-case and worst-case
 * score is for each dimension across the three choices (including
 * 0 for dimensions not scored by any choice). Then we sum across
 * all 8 slots.
 */
export function computeScoringBounds(slotIds: string[]): ScoringBounds {
  const maxPerDim: Record<string, number> = {};
  const minPerDim: Record<string, number> = {};

  for (const dim of DIMENSIONS) {
    maxPerDim[dim] = 0;
    minPerDim[dim] = 0;
  }

  for (const slotId of slotIds) {
    const slot = ALL_SLOTS.find((s) => s.slot_id === slotId);
    if (!slot) continue;

    for (const dim of DIMENSIONS) {
      const scoresForDim = choiceScoresForDimension(slot.scores, dim);
      maxPerDim[dim] += Math.max(...scoresForDim);
      minPerDim[dim] += Math.min(...scoresForDim);
    }
  }

  return {
    maxPerDim: maxPerDim as Record<Dimension, number>,
    minPerDim: minPerDim as Record<Dimension, number>,
  };
}

/**
 * For a given slot's scores and a dimension, return the score
 * each choice would contribute to that dimension.
 * Choices that don't score the dimension contribute 0.
 */
function choiceScoresForDimension(
  scores: SlotScores,
  dim: Dimension
): [number, number, number] {
  return [
    (scores.A as Record<string, number>)[dim] ?? 0,
    (scores.B as Record<string, number>)[dim] ?? 0,
    (scores.C as Record<string, number>)[dim] ?? 0,
  ];
}

/**
 * Compute the scoring envelope for a single slot — used for
 * validation / debugging to verify all variants in a slot share
 * the same envelope (which is automatic in our design since
 * scores are at the slot level, not the variant level).
 */
export function slotScoringEnvelope(
  slotId: string
): Record<Dimension, { min: number; max: number }> | null {
  const slot = ALL_SLOTS.find((s) => s.slot_id === slotId);
  if (!slot) return null;

  const envelope: Record<string, { min: number; max: number }> = {};
  for (const dim of DIMENSIONS) {
    const vals = choiceScoresForDimension(slot.scores, dim);
    envelope[dim] = { min: Math.min(...vals), max: Math.max(...vals) };
  }
  return envelope as Record<Dimension, { min: number; max: number }>;
}

// ── Slot Lookup ─────────────────────────────────────────────────────
export function getSlotById(slotId: string): SlotTemplate | null {
  return ALL_SLOTS.find((s) => s.slot_id === slotId) ?? null;
}

export function getAllSlots(): SlotTemplate[] {
  return ALL_SLOTS;
}
