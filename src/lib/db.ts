import { promises as fs } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { Pool, neonConfig } from "@neondatabase/serverless";
import type {
  Test,
  Participant,
  StorySeed,
  DimensionScores,
  Comparison,
  RenderedScenario,
  RelationshipType,
} from "./types";
import { generateSessionToken } from "./security";

// Neon serverless configuration
neonConfig.fetchConnectionCache = true;

const DB_PATH = path.join(process.cwd(), ".data", "db.json");

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

interface DBSchema {
  tests: Test[];
  participants: Participant[];
  scenario_instances: ScenarioInstance[];
  comparisons: Comparison[];
  events: EventRecord[];
}

// ── PostgreSQL Connection Pool (Neon) ────────────────────────────────
let pgPool: Pool | null = null;

function getPgPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "DATABASE_URL environment variable is required in production. Refusing silent fallback to local JSON file."
      );
    }
    return null;
  }

  if (!pgPool) {
    pgPool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return pgPool;
}

// ── Local JSON Fallback Driver ───────────────────────────────────────
async function readLocalJSON(): Promise<DBSchema> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Local JSON database is disabled in production. Set DATABASE_URL to a valid PostgreSQL connection string."
    );
  }
  try {
    const data = await fs.readFile(DB_PATH, "utf-8");
    const parsed: DBSchema = JSON.parse(data);
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

async function writeLocalJSON(db: DBSchema): Promise<void> {
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
  const id = testId ?? uuidv4();
  const participantId = uuidv4();
  const sessionToken = generateSessionToken();
  const now = new Date().toISOString();

  const pool = getPgPool();
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      let rootTestId = id;
      let generationDepth = 0;
      let validParentId: string | null = null;
      let validCreatorParticipantId: string | null = null;

      if (parentTestId) {
        const parentRes = await client.query(
          `SELECT id, root_test_id, generation_depth FROM tests WHERE id = $1`,
          [parentTestId]
        );
        if (parentRes.rows.length > 0) {
          const parentRow = parentRes.rows[0];

          if (createdByParticipantId) {
            const partRes = await client.query(
              `SELECT id, status FROM participants WHERE id = $1 AND test_id = $2`,
              [createdByParticipantId, parentTestId]
            );
            if (partRes.rows.length > 0 && partRes.rows[0].status === "completed") {
              validParentId = parentRow.id;
              validCreatorParticipantId = partRes.rows[0].id;
              rootTestId = parentRow.root_test_id || parentRow.id;
              generationDepth = (parentRow.generation_depth || 0) + 1;
            }
          } else {
            const hasCompletedRes = await client.query(
              `SELECT id FROM participants WHERE test_id = $1 AND status = 'completed' LIMIT 1`,
              [parentTestId]
            );
            if (hasCompletedRes.rows.length > 0) {
              validParentId = parentRow.id;
              validCreatorParticipantId = null;
              rootTestId = parentRow.root_test_id || parentRow.id;
              generationDepth = (parentRow.generation_depth || 0) + 1;
            }
          }
        }
      }

      const testRow = await client.query(
        `INSERT INTO tests (id, relationship_type, story_seed, parent_test_id, created_by_participant_id, root_test_id, generation_depth, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, relationship_type, story_seed, parent_test_id, created_by_participant_id, root_test_id, generation_depth, created_at`,
        [
          id,
          relationshipType,
          JSON.stringify(storySeed),
          validParentId,
          validCreatorParticipantId,
          rootTestId,
          generationDepth,
          now,
        ]
      );

      const participantRow = await client.query(
        `INSERT INTO participants (id, test_id, role, status, display_name, dimension_scores, session_token, created_at)
         VALUES ($1, $2, 'A', 'in_progress', $3, NULL, $4, $5)
         RETURNING id, test_id, role, status, display_name, dimension_scores, session_token, created_at`,
        [participantId, id, displayName?.trim() || null, sessionToken, now]
      );

      await client.query("COMMIT");

      const t = testRow.rows[0];
      const p = participantRow.rows[0];

      return {
        test: {
          id: t.id,
          relationship_type: t.relationship_type,
          story_seed: typeof t.story_seed === "string" ? JSON.parse(t.story_seed) : t.story_seed,
          parent_test_id: t.parent_test_id,
          created_by_participant_id: t.created_by_participant_id,
          root_test_id: t.root_test_id,
          generation_depth: t.generation_depth,
          created_at: new Date(t.created_at).toISOString(),
        },
        participant: {
          id: p.id,
          test_id: p.test_id,
          role: p.role,
          status: p.status,
          display_name: p.display_name,
          dimension_scores: p.dimension_scores,
          session_token: p.session_token,
          created_at: new Date(p.created_at).toISOString(),
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // JSON Fallback
  const db = await readLocalJSON();
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
        if (creatorParticipant && creatorParticipant.status === "completed") {
          validParentId = parentTest.id;
          validCreatorParticipantId = creatorParticipant.id;
          rootTestId = parentTest.root_test_id || parentTest.id;
          generationDepth = (parentTest.generation_depth ?? 0) + 1;
        }
      } else {
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
    created_at: now,
  };

  const participant: Participant = {
    id: participantId,
    test_id: test.id,
    role: "A",
    status: "in_progress",
    display_name: displayName?.trim() || null,
    dimension_scores: null,
    session_token: sessionToken,
    created_at: now,
  };

  db.tests.push(test);
  db.participants.push(participant);
  await writeLocalJSON(db);

  return { test, participant };
}

export async function getTest(testId: string): Promise<Test | null> {
  const pool = getPgPool();
  if (pool) {
    const res = await pool.query(
      `SELECT id, relationship_type, story_seed, parent_test_id, created_by_participant_id, root_test_id, generation_depth, created_at
       FROM tests WHERE id = $1`,
      [testId]
    );
    if (res.rows.length === 0) return null;
    const t = res.rows[0];
    return {
      id: t.id,
      relationship_type: t.relationship_type,
      story_seed: typeof t.story_seed === "string" ? JSON.parse(t.story_seed) : t.story_seed,
      parent_test_id: t.parent_test_id,
      created_by_participant_id: t.created_by_participant_id,
      root_test_id: t.root_test_id,
      generation_depth: t.generation_depth,
      created_at: new Date(t.created_at).toISOString(),
    };
  }

  const db = await readLocalJSON();
  return db.tests.find((t) => t.id === testId) ?? null;
}

// ── Participants ────────────────────────────────────────────────────

export async function getParticipant(
  participantId: string
): Promise<Participant | null> {
  const pool = getPgPool();
  if (pool) {
    const res = await pool.query(
      `SELECT id, test_id, role, status, display_name, dimension_scores, session_token, created_at
       FROM participants WHERE id = $1`,
      [participantId]
    );
    if (res.rows.length === 0) return null;
    const p = res.rows[0];
    return {
      id: p.id,
      test_id: p.test_id,
      role: p.role,
      status: p.status,
      display_name: p.display_name,
      dimension_scores: p.dimension_scores
        ? typeof p.dimension_scores === "string"
          ? JSON.parse(p.dimension_scores)
          : p.dimension_scores
        : null,
      session_token: p.session_token,
      created_at: new Date(p.created_at).toISOString(),
    };
  }

  const db = await readLocalJSON();
  return db.participants.find((p) => p.id === participantId) ?? null;
}

export async function getParticipantsByTestId(
  testId: string
): Promise<Participant[]> {
  const pool = getPgPool();
  if (pool) {
    const res = await pool.query(
      `SELECT id, test_id, role, status, display_name, dimension_scores, session_token, created_at
       FROM participants WHERE test_id = $1 ORDER BY created_at ASC`,
      [testId]
    );
    return res.rows.map((p) => ({
      id: p.id,
      test_id: p.test_id,
      role: p.role,
      status: p.status,
      display_name: p.display_name,
      dimension_scores: p.dimension_scores
        ? typeof p.dimension_scores === "string"
          ? JSON.parse(p.dimension_scores)
          : p.dimension_scores
        : null,
      session_token: p.session_token,
      created_at: new Date(p.created_at).toISOString(),
    }));
  }

  const db = await readLocalJSON();
  return db.participants.filter((p) => p.test_id === testId);
}

export interface CreateParticipantBResult {
  participant: Participant;
  wasCreated: boolean;
}

export async function createParticipantB(
  testId: string,
  displayName?: string
): Promise<CreateParticipantBResult | null> {
  const sessionToken = generateSessionToken();
  const now = new Date().toISOString();

  const pool = getPgPool();
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Verify test exists
      const testRes = await client.query(`SELECT id FROM tests WHERE id = $1`, [testId]);
      if (testRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      // Check if B already exists (with row locking)
      const existingB = await client.query(
        `SELECT id, test_id, role, status, display_name, dimension_scores, session_token, created_at
         FROM participants WHERE test_id = $1 AND role = 'B' FOR UPDATE`,
        [testId]
      );

      if (existingB.rows.length > 0) {
        const b = existingB.rows[0];
        if (displayName?.trim() && !b.display_name) {
          await client.query(
            `UPDATE participants SET display_name = $1 WHERE id = $2`,
            [displayName.trim(), b.id]
          );
          b.display_name = displayName.trim();
        }
        await client.query("COMMIT");
        return {
          participant: {
            id: b.id,
            test_id: b.test_id,
            role: b.role,
            status: b.status,
            display_name: b.display_name,
            dimension_scores: b.dimension_scores,
            session_token: b.session_token,
            created_at: new Date(b.created_at).toISOString(),
          },
          wasCreated: false,
        };
      }

      const participantId = uuidv4();
      const insertRes = await client.query(
        `INSERT INTO participants (id, test_id, role, status, display_name, dimension_scores, session_token, created_at)
         VALUES ($1, $2, 'B', 'in_progress', $3, NULL, $4, $5)
         RETURNING id, test_id, role, status, display_name, dimension_scores, session_token, created_at`,
        [participantId, testId, displayName?.trim() || null, sessionToken, now]
      );

      await client.query("COMMIT");
      const p = insertRes.rows[0];
      return {
        participant: {
          id: p.id,
          test_id: p.test_id,
          role: p.role,
          status: p.status,
          display_name: p.display_name,
          dimension_scores: p.dimension_scores,
          session_token: p.session_token,
          created_at: new Date(p.created_at).toISOString(),
        },
        wasCreated: true,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // JSON Fallback
  const db = await readLocalJSON();
  const test = db.tests.find((t) => t.id === testId);
  if (!test) return null;

  const existingB = db.participants.find(
    (p) => p.test_id === testId && p.role === "B"
  );
  if (existingB) {
    if (displayName?.trim() && !existingB.display_name) {
      existingB.display_name = displayName.trim();
      await writeLocalJSON(db);
    }
    return {
      participant: existingB,
      wasCreated: false,
    };
  }

  const participant: Participant = {
    id: uuidv4(),
    test_id: testId,
    role: "B",
    status: "in_progress",
    display_name: displayName?.trim() || null,
    dimension_scores: null,
    session_token: sessionToken,
    created_at: now,
  };

  db.participants.push(participant);
  await writeLocalJSON(db);
  return {
    participant,
    wasCreated: true,
  };
}

export async function updateParticipantScores(
  participantId: string,
  scores: DimensionScores
): Promise<void> {
  const pool = getPgPool();
  if (pool) {
    await pool.query(
      `UPDATE participants
       SET dimension_scores = $1, status = 'completed'
       WHERE id = $2`,
      [JSON.stringify(scores), participantId]
    );
    return;
  }

  const db = await readLocalJSON();
  const participant = db.participants.find((p) => p.id === participantId);
  if (participant) {
    participant.dimension_scores = scores;
    participant.status = "completed";
    await writeLocalJSON(db);
  }
}

// ── Scenario Instances ──────────────────────────────────────────────

export async function getScenarioInstances(
  participantId: string
): Promise<ScenarioInstance[]> {
  const pool = getPgPool();
  if (pool) {
    const res = await pool.query(
      `SELECT id, participant_id, sequence_index, slot_id, variant_id, rendered_scenario, chosen_option, created_at
       FROM scenario_instances
       WHERE participant_id = $1
       ORDER BY sequence_index ASC`,
      [participantId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      participant_id: r.participant_id,
      sequence_index: r.sequence_index,
      slot_id: r.slot_id,
      variant_id: r.variant_id,
      rendered_scenario:
        typeof r.rendered_scenario === "string"
          ? JSON.parse(r.rendered_scenario)
          : r.rendered_scenario,
      chosen_option: r.chosen_option,
      created_at: new Date(r.created_at).toISOString(),
    }));
  }

  const db = await readLocalJSON();
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
  const id = uuidv4();
  const now = new Date().toISOString();

  const pool = getPgPool();
  if (pool) {
    const res = await pool.query(
      `INSERT INTO scenario_instances (id, participant_id, sequence_index, slot_id, variant_id, rendered_scenario, chosen_option, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)
       ON CONFLICT (participant_id, sequence_index) DO UPDATE
       SET slot_id = EXCLUDED.slot_id, variant_id = EXCLUDED.variant_id, rendered_scenario = EXCLUDED.rendered_scenario
       RETURNING id, participant_id, sequence_index, slot_id, variant_id, rendered_scenario, chosen_option, created_at`,
      [
        id,
        participantId,
        sequenceIndex,
        slotId,
        variantId,
        JSON.stringify(renderedScenario),
        now,
      ]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      participant_id: r.participant_id,
      sequence_index: r.sequence_index,
      slot_id: r.slot_id,
      variant_id: r.variant_id,
      rendered_scenario:
        typeof r.rendered_scenario === "string"
          ? JSON.parse(r.rendered_scenario)
          : r.rendered_scenario,
      chosen_option: r.chosen_option,
      created_at: new Date(r.created_at).toISOString(),
    };
  }

  const db = await readLocalJSON();
  const instance: ScenarioInstance = {
    id,
    participant_id: participantId,
    sequence_index: sequenceIndex,
    slot_id: slotId,
    variant_id: variantId,
    rendered_scenario: renderedScenario,
    chosen_option: null,
    created_at: now,
  };

  db.scenario_instances.push(instance);
  await writeLocalJSON(db);
  return instance;
}

export async function updateScenarioChoice(
  instanceId: string,
  chosenOption: "A" | "B" | "C"
): Promise<ScenarioInstance | null> {
  const pool = getPgPool();
  if (pool) {
    const res = await pool.query(
      `UPDATE scenario_instances
       SET chosen_option = $1
       WHERE id = $2 AND chosen_option IS NULL
       RETURNING id, participant_id, sequence_index, slot_id, variant_id, rendered_scenario, chosen_option, created_at`,
      [chosenOption, instanceId]
    );
    if (!res.rowCount || res.rowCount === 0 || res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      participant_id: r.participant_id,
      sequence_index: r.sequence_index,
      slot_id: r.slot_id,
      variant_id: r.variant_id,
      rendered_scenario:
        typeof r.rendered_scenario === "string"
          ? JSON.parse(r.rendered_scenario)
          : r.rendered_scenario,
      chosen_option: r.chosen_option,
      created_at: new Date(r.created_at).toISOString(),
    };
  }

  const db = await readLocalJSON();
  const instance = db.scenario_instances.find((si) => si.id === instanceId);
  if (!instance || instance.chosen_option !== null) return null;

  instance.chosen_option = chosenOption;
  await writeLocalJSON(db);
  return instance;
}

// ── Comparisons ─────────────────────────────────────────────────────

export async function getComparison(
  testId: string
): Promise<Comparison | null> {
  const pool = getPgPool();
  if (pool) {
    const res = await pool.query(
      `SELECT id, test_id, bond_score, strongest_dimension, most_different_dimension, friendship_type, narrative_summary, created_at
       FROM comparisons WHERE test_id = $1`,
      [testId]
    );
    if (res.rows.length === 0) return null;
    const c = res.rows[0];
    return {
      id: c.id,
      test_id: c.test_id,
      bond_score: c.bond_score,
      strongest_dimension: c.strongest_dimension,
      most_different_dimension: c.most_different_dimension,
      friendship_type: c.friendship_type,
      narrative_summary: c.narrative_summary,
      created_at: new Date(c.created_at).toISOString(),
    };
  }

  const db = await readLocalJSON();
  return db.comparisons.find((c) => c.test_id === testId) ?? null;
}

export async function createComparison(
  comparison: Comparison
): Promise<void> {
  const pool = getPgPool();
  if (pool) {
    await pool.query(
      `INSERT INTO comparisons (id, test_id, bond_score, strongest_dimension, most_different_dimension, friendship_type, narrative_summary, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (test_id) DO UPDATE
       SET bond_score = EXCLUDED.bond_score,
           strongest_dimension = EXCLUDED.strongest_dimension,
           most_different_dimension = EXCLUDED.most_different_dimension,
           friendship_type = EXCLUDED.friendship_type,
           narrative_summary = EXCLUDED.narrative_summary`,
      [
        comparison.id,
        comparison.test_id,
        comparison.bond_score,
        comparison.strongest_dimension,
        comparison.most_different_dimension,
        comparison.friendship_type,
        comparison.narrative_summary,
        comparison.created_at,
      ]
    );
    return;
  }

  const db = await readLocalJSON();
  db.comparisons.push(comparison);
  await writeLocalJSON(db);
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
    const id = uuidv4();
    const now = new Date().toISOString();

    const pool = getPgPool();
    if (pool) {
      await pool.query(
        `INSERT INTO events (id, event_type, test_id, participant_id, role, timestamp, created_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          eventType,
          testId ?? null,
          options?.participantId ?? null,
          options?.role ?? null,
          now,
          now,
          options?.metadata ? JSON.stringify(options.metadata) : null,
        ]
      );
      return;
    }

    const db = await readLocalJSON();
    db.events.push({
      id,
      event_type: eventType,
      test_id: testId ?? null,
      participant_id: options?.participantId ?? null,
      role: options?.role ?? null,
      timestamp: now,
      created_at: now,
      metadata: options?.metadata ?? null,
    });
    await writeLocalJSON(db);
  } catch (error) {
    // Best-effort: analytics errors must never break user flow
    console.error("Failed to log event:", error);
  }
}

export async function countShares(): Promise<number> {
  const pool = getPgPool();
  if (pool) {
    const res = await pool.query(
      `SELECT COUNT(*)::int AS count FROM events WHERE event_type = 'result_shared'`
    );
    return res.rows[0]?.count ?? 0;
  }

  const db = await readLocalJSON();
  return db.events.filter((e) => e.event_type === "result_shared").length;
}
