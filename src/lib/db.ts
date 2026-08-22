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

interface EventRecord {
  id: string;
  test_id: string | null;
  event_type: string;
  created_at: string;
}

async function readDB(): Promise<DBSchema> {
  try {
    const data = await fs.readFile(DB_PATH, "utf-8");
    return JSON.parse(data);
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
  testId?: string
): Promise<{ test: Test; participant: Participant }> {
  const db = await readDB();

  const test: Test = {
    id: testId ?? uuidv4(),
    relationship_type: relationshipType,
    story_seed: storySeed,
    created_at: new Date().toISOString(),
  };

  const participant: Participant = {
    id: uuidv4(),
    test_id: test.id,
    role: "A",
    status: "in_progress",
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
  testId: string
): Promise<Participant | null> {
  const db = await readDB();
  const test = db.tests.find((t) => t.id === testId);
  if (!test) return null;

  // Check if B already exists
  const existingB = db.participants.find(
    (p) => p.test_id === testId && p.role === "B"
  );
  if (existingB) return existingB;

  const participant: Participant = {
    id: uuidv4(),
    test_id: testId,
    role: "B",
    status: "in_progress",
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

export async function logEvent(
  eventType: string,
  testId?: string
): Promise<void> {
  const db = await readDB();
  db.events.push({
    id: uuidv4(),
    test_id: testId ?? null,
    event_type: eventType,
    created_at: new Date().toISOString(),
  });
  await writeDB(db);
}

export async function countShares(): Promise<number> {
  const db = await readDB();
  return db.events.filter((e) => e.event_type === "result_shared").length;
}
