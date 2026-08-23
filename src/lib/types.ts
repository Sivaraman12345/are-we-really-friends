import { z } from "zod";

// ── Dimensions ──────────────────────────────────────────────────────
export const DIMENSIONS = [
  "trust",
  "loyalty",
  "empathy",
  "communication",
  "adventure",
  "conflict_handling",
  "humor",
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

export const DimensionSchema = z.enum(DIMENSIONS);

// ── Score Map ───────────────────────────────────────────────────────
// Sparse: a choice typically affects 1-3 dimensions, not all 7.
export const ScoreMapSchema = z
  .record(z.string(), z.number().int().min(-3).max(3))
  .refine(
    (obj) => {
      const keys = Object.keys(obj);
      return (
        keys.length > 0 &&
        keys.every((k) => (DIMENSIONS as readonly string[]).includes(k))
      );
    },
    { message: "Score map must have ≥1 key and all keys must be valid dimensions" }
  );

export type ScoreMap = z.infer<typeof ScoreMapSchema>;

// ── Tendency ────────────────────────────────────────────────────────
// A running signal derived from accumulated choices.
// "bold"       → biased toward adventure, trust, humor
// "thoughtful" → biased toward empathy, communication, loyalty
export const TendencySchema = z.enum(["bold", "thoughtful"]);
export type Tendency = z.infer<typeof TendencySchema>;

// ── Slot Scores ─────────────────────────────────────────────────────
// Scores are defined per-slot (NOT per-variant).
// Every variant within a slot shares these exact values, which
// guarantees an identical scoring envelope for A vs B comparability.
export const SlotScoresSchema = z.object({
  A: ScoreMapSchema,
  B: ScoreMapSchema,
  C: ScoreMapSchema,
});

export type SlotScores = z.infer<typeof SlotScoresSchema>;

// ── Variant Template ────────────────────────────────────────────────
// The narrative layer — different text, same scores.
export const VariantTemplateSchema = z.object({
  id: z.string(),
  tendency: TendencySchema,
  situation: z.string().min(20).max(1200),
  choice_texts: z.object({
    A: z.string().min(10).max(500),
    B: z.string().min(10).max(500),
    C: z.string().min(10).max(500),
  }),
});

export type VariantTemplate = z.infer<typeof VariantTemplateSchema>;

// ── Slot Template ───────────────────────────────────────────────────
// A theme slot with 2–3 variant narratives sharing the same scoring.
export const SlotTemplateSchema = z.object({
  slot_id: z.string(),
  theme: DimensionSchema,
  scores: SlotScoresSchema,
  variants: z.array(VariantTemplateSchema).min(2).max(3),
});

export type SlotTemplate = z.infer<typeof SlotTemplateSchema>;

// ── Scoring Envelope ────────────────────────────────────────────────
// Per-dimension min/max achievable across all choices in a slot.
// Computed programmatically, never hardcoded.
export interface ScoringEnvelope {
  [dim: string]: { min: number; max: number };
}

export interface ScoringBounds {
  maxPerDim: Record<Dimension, number>;
  minPerDim: Record<Dimension, number>;
}

// ── Choice (for rendered scenarios) ─────────────────────────────────
export const ChoiceSchema = z.object({
  id: z.enum(["A", "B", "C"]),
  text: z.string().min(10).max(500),
  scores: ScoreMapSchema,
});

export type Choice = z.infer<typeof ChoiceSchema>;

// ── Rendered Scenario (stored per participant) ──────────────────────
export const RenderedScenarioSchema = z.object({
  theme: DimensionSchema,
  situation: z.string(),
  choices: z.tuple([ChoiceSchema, ChoiceSchema, ChoiceSchema]),
});

export type RenderedScenario = z.infer<typeof RenderedScenarioSchema>;

// ── Story Seed ──────────────────────────────────────────────────────
// Stored in tests.story_seed — determines the slot sequence.
// Variant selection happens at play-time via the tendency signal.
export const StorySeedSchema = z.object({
  theme_sequence: z.array(DimensionSchema).length(8),
  slot_ids: z.array(z.string()).length(8),
});

export type StorySeed = z.infer<typeof StorySeedSchema>;

// ── Dimension Scores ────────────────────────────────────────────────
export const DimensionScoresSchema = z.record(
  DimensionSchema,
  z.number().int().min(0).max(100)
);

export type DimensionScores = z.infer<typeof DimensionScoresSchema>;

// ── Raw Scores (accumulated during gameplay) ────────────────────────
export const RawScoresSchema = z.record(DimensionSchema, z.number().int());

export type RawScores = z.infer<typeof RawScoresSchema>;

// ── Test ────────────────────────────────────────────────────────────
export const RelationshipTypeSchema = z.enum([
  "best_friend",
  "close_friend",
  "new_friend",
  "crush",
]);

export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

export const TestSchema = z.object({
  id: z.string().uuid(),
  relationship_type: RelationshipTypeSchema,
  story_seed: StorySeedSchema,
  created_at: z.string(),
});

export type Test = z.infer<typeof TestSchema>;

// ── Participant ─────────────────────────────────────────────────────
export const ParticipantRoleSchema = z.enum(["A", "B"]);
export const ParticipantStatusSchema = z.enum(["in_progress", "completed"]);

export const ParticipantSchema = z.object({
  id: z.string().uuid(),
  test_id: z.string().uuid(),
  role: ParticipantRoleSchema,
  status: ParticipantStatusSchema,
  display_name: z.string().trim().min(1).max(50).nullable().default(null),
  dimension_scores: DimensionScoresSchema.nullable(),
  created_at: z.string(),
});

export type Participant = z.infer<typeof ParticipantSchema>;

// ── Comparison ──────────────────────────────────────────────────────
export const ComparisonSchema = z.object({
  id: z.string().uuid(),
  test_id: z.string().uuid(),
  bond_score: z.number().int().min(0).max(100),
  strongest_dimension: DimensionSchema,
  most_different_dimension: DimensionSchema,
  friendship_type: z.string(),
  narrative_summary: z.string(),
  created_at: z.string(),
});

export type Comparison = z.infer<typeof ComparisonSchema>;

// ── Gemini Result Response ──────────────────────────────────────────
export const GeminiResultSchema = z.object({
  friendship_type: z.string().min(3).max(100),
  narrative: z.string().min(50).max(2000),
});

export type GeminiResult = z.infer<typeof GeminiResultSchema>;

// ── API Request/Response Schemas ────────────────────────────────────
export const CreateTestRequestSchema = z.object({
  relationship_type: RelationshipTypeSchema.default("best_friend"),
  display_name: z.string().trim().min(1).max(50).optional(),
});

export const SubmitChoiceRequestSchema = z.object({
  participant_id: z.string().uuid(),
  scenario_index: z.number().int().min(0).max(7),
  chosen_option: z.enum(["A", "B", "C"]),
});

export const JoinTestRequestSchema = z.object({
  display_name: z.string().trim().min(1).max(50).optional(),
});

// ── Constants ───────────────────────────────────────────────────────
export const TOTAL_SCENARIOS = 8;
export const SHARE_THRESHOLD_FOR_ADS = 200;
