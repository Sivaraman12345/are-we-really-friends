import { promises as fs } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type {
  Test,
  Participant,
  StorySeed,
  DimensionScores,
  Comparison,
  RenderedScenario,
  RelationshipType,
} from "./types";

/**
 * Simple file-based database for local development.
 *
 * In production (Cloudflare Workers), this will be replaced with D1 bindings.
 * The interface is kept deliberately simple so the swap is trivial.
 *
 * All data is stored in a single JSON file — this is not scalable,
 * but it's perfect for local dev and testing the A→B→result loop.
 */

const DB_PATH = path.join(process.cwd(), ".data", "db.json");

interface DBSchema {
  tests: Test[];
  participants: Participant[];
  scenario_instances: ScenarioInstance[];
  comparisons: Comparison[];
  events: EventRecord[];
}

interface ScenarioInstance {
  id: string;
  participant_id: string;
  sequence_index: number;
  slot_id: string;
  variant_id: string;
  rendered_scenario: RenderedScenario;
  chosen_option: "A" | "B" | "C" | null;
  created_at: string;
}

export interface EventRecord {
  id: string;
  event_type: string;
  test_id: string | null;
  participant_id?: string | null;
  role?: "A" | "B" | null;
  timestamp?: string;
  created_at: string;
  metadata?: Record<string, unknown> | null;
}

async function readDB(): Promise<DBSchema> {
  try {
    const data = await fs.readFile(DB_PATH, "utf-8");
    const parsed: DBSchema = JSON.parse(data);
    // Ensure backward compatibility for tests created before Phase 5A
    parsed.tests = (parsed.tests || []).map((t) => ({
      ...t,
      parent_test_id: t.parent_test_id ?? null,
      created_by_participant_id: t.created_by_participant_id ?? null,
      root_test_id: t.root_test_id ?? t.id,
      generation_depth: t.generation_depth ?? 0,
    }));
    parsed.participants = parsed.participants || [];
    parsed.scenario_instances = parsed.scenario_instances || [];
    parsed.comparisons = parsed.comparisons || [];
    parsed.events = parsed.events || [];
    return parsed;
  } catch {
    return {
      tests: [],
      participants: [],
      scenario_instances: [],
      comparisons: [],
      events: [],
    };
  }
}

async function writeDB(db: DBSchema): Promise<void> {
  const dir = path.dirname(DB_PATH);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

// ── Tests ───────────────────────────────────────────────────────────

export async function createTest(
  relationshipType: RelationshipType,
  storySeed: StorySeed,
  displayName?: string,
  testId?: string,
  parentTestId?: string | null,
  createdByParticipantId?: string | null
): Promise<{ test: Test; participant: Participant }> {
  const db = await readDB();
  const id = testId ?? uuidv4();

  let rootTestId = id;
  let generationDepth = 0;
  let validParentId: string | null = null;
  let validCreatorParticipantId: string | null = null;

  if (parentTestId) {
    const parentTest = db.tests.find((t) => t.id === parentTestId);
    if (parentTest) {
      const parentParticipants = db.participants.filter(
        (p) => p.test_id === parentTest.id
      );

      if (createdByParticipantId) {
        const creatorParticipant = parentParticipants.find(
          (p) => p.id === createdByParticipantId
        );
        // Valid if the participant belongs to the parent test and has completed it
        if (creatorParticipant && creatorParticipant.status === "completed") {
          validParentId = parentTest.id;
          validCreatorParticipantId = creatorParticipant.id;
          rootTestId = parentTest.root_test_id || parentTest.id;
          generationDepth = (parentTest.generation_depth ?? 0) + 1;
        }
      } else {
        // If participant ID was not provided, parent test must have at least one completed participant
        const hasCompleted = parentParticipants.some(
          (p) => p.status === "completed"
        );
        if (hasCompleted) {
          validParentId = parentTest.id;
          validCreatorParticipantId = null;
          rootTestId = parentTest.root_test_id || parentTest.id;
          generationDepth = (parentTest.generation_depth ?? 0) + 1;
        }
      }
    }
  }

  const test: Test = {
    id,
    relationship_type: relationshipType,
    story_seed: storySeed,
    parent_test_id: validParentId,
    created_by_participant_id: validCreatorParticipantId,
    root_test_id: rootTestId,
    generation_depth: generationDepth,
    created_at: new Date().toISOString(),
  };

  const participant: Participant = {
    id: uuidv4(),
    test_id: test.id,
    role: "A",
    status: "in_progress",
    display_name: displayName?.trim() || null,
    dimension_scores: null,
    created_at: new Date().toISOString(),
  };

  db.tests.push(test);
  db.participants.push(participant);
  await writeDB(db);

  return { test, participant };
}

export async function getTest(testId: string): Promise<Test | null> {
  const db = await readDB();
  return db.tests.find((t) => t.id === testId) ?? null;
}

// ── Participants ────────────────────────────────────────────────────

export async function getParticipant(
  participantId: string
): Promise<Participant | null> {
  const db = await readDB();
  return db.participants.find((p) => p.id === participantId) ?? null;
}

export async function getParticipantsByTestId(
  testId: string
): Promise<Participant[]> {
  const db = await readDB();
  return db.participants.filter((p) => p.test_id === testId);
}

export async function createParticipantB(
  testId: string,
  displayName?: string
): Promise<Participant | null> {
  const db = await readDB();
  const test = db.tests.find((t) => t.id === testId);
  if (!test) return null;

  // Check if B already exists
  const existingB = db.participants.find(
    (p) => p.test_id === testId && p.role === "B"
  );
  if (existingB) {
    if (displayName?.trim() && !existingB.display_name) {
      existingB.display_name = displayName.trim();
      await writeDB(db);
    }
    return existingB;
  }

  const participant: Participant = {
    id: uuidv4(),
    test_id: testId,
    role: "B",
    status: "in_progress",
    display_name: displayName?.trim() || null,
    dimension_scores: null,
    created_at: new Date().toISOString(),
  };

  db.participants.push(participant);
  await writeDB(db);
  return participant;
}

export async function updateParticipantScores(
  participantId: string,
  scores: DimensionScores
): Promise<void> {
  const db = await readDB();
  const participant = db.participants.find((p) => p.id === participantId);
  if (participant) {
    participant.dimension_scores = scores;
    participant.status = "completed";
    await writeDB(db);
  }
}

// ── Scenario Instances ──────────────────────────────────────────────

export async function getScenarioInstances(
  participantId: string
): Promise<ScenarioInstance[]> {
  const db = await readDB();
  return db.scenario_instances
    .filter((si) => si.participant_id === participantId)
    .sort((a, b) => a.sequence_index - b.sequence_index);
}

export async function createScenarioInstance(
  participantId: string,
  sequenceIndex: number,
  slotId: string,
  variantId: string,
  renderedScenario: RenderedScenario
): Promise<ScenarioInstance> {
  const db = await readDB();

  const instance: ScenarioInstance = {
    id: uuidv4(),
    participant_id: participantId,
    sequence_index: sequenceIndex,
    slot_id: slotId,
    variant_id: variantId,
    rendered_scenario: renderedScenario,
    chosen_option: null,
    created_at: new Date().toISOString(),
  };

  db.scenario_instances.push(instance);
  await writeDB(db);
  return instance;
}

export async function updateScenarioChoice(
  instanceId: string,
  chosenOption: "A" | "B" | "C"
): Promise<ScenarioInstance | null> {
  const db = await readDB();
  const instance = db.scenario_instances.find((si) => si.id === instanceId);
  if (!instance) return null;

  instance.chosen_option = chosenOption;
  await writeDB(db);
  return instance;
}

// ── Comparisons ─────────────────────────────────────────────────────

export async function getComparison(
  testId: string
): Promise<Comparison | null> {
  const db = await readDB();
  return db.comparisons.find((c) => c.test_id === testId) ?? null;
}

export async function createComparison(
  comparison: Comparison
): Promise<void> {
  const db = await readDB();
  db.comparisons.push(comparison);
  await writeDB(db);
}

// ── Events ──────────────────────────────────────────────────────────

export interface LogEventOptions {
  participantId?: string | null;
  role?: "A" | "B" | null;
  metadata?: Record<string, unknown> | null;
}

export async function logEvent(
  eventType: string,
  testId?: string | null,
  options?: LogEventOptions
): Promise<void> {
  try {
    const db = await readDB();
    const now = new Date().toISOString();
    db.events.push({
      id: uuidv4(),
      event_type: eventType,
      test_id: testId ?? null,
      participant_id: options?.participantId ?? null,
      role: options?.role ?? null,
      timestamp: now,
      created_at: now,
      metadata: options?.metadata ?? null,
    });
    await writeDB(db);
  } catch (error) {
    // Best-effort: analytics errors must never break user flow
    console.error("Failed to log event:", error);
  }
}

export async function countShares(): Promise<number> {
  const db = await readDB();
  return db.events.filter((e) => e.event_type === "result_shared").length;
}
