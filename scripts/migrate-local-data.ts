/**
 * Explicit migration script to import existing local `.data/db.json` records
 * into a target PostgreSQL (Neon) database.
 *
 * Usage:
 *   DATABASE_URL="postgres://..." npx tsx scripts/migrate-local-data.ts
 */

import { promises as fs } from "fs";
import path from "path";
import { Pool } from "@neondatabase/serverless";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Error: DATABASE_URL environment variable is not set.");
    process.exit(1);
  }

  const jsonPath = path.join(process.cwd(), ".data", "db.json");
  let dataRaw: string;
  try {
    dataRaw = await fs.readFile(jsonPath, "utf-8");
  } catch {
    console.log("No local .data/db.json found. Nothing to migrate.");
    process.exit(0);
  }

  const db = JSON.parse(dataRaw);
  const pool = new Pool({ connectionString: databaseUrl });

  console.log("Applying schema...");
  const schemaPath = path.join(__dirname, "schema.sql");
  const schemaSql = await fs.readFile(schemaPath, "utf-8");
  await pool.query(schemaSql);
  console.log("Schema applied successfully.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Migrate Tests
    const tests = db.tests || [];
    console.log(`Migrating ${tests.length} tests...`);
    for (const t of tests) {
      await client.query(
        `INSERT INTO tests (id, relationship_type, story_seed, parent_test_id, created_by_participant_id, root_test_id, generation_depth, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          t.id,
          t.relationship_type,
          JSON.stringify(t.story_seed),
          t.parent_test_id ?? null,
          t.created_by_participant_id ?? null,
          t.root_test_id ?? t.id,
          t.generation_depth ?? 0,
          t.created_at || new Date().toISOString(),
        ]
      );
    }

    // 2. Migrate Participants
    const participants = db.participants || [];
    console.log(`Migrating ${participants.length} participants...`);
    for (const p of participants) {
      await client.query(
        `INSERT INTO participants (id, test_id, role, status, display_name, dimension_scores, session_token, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          p.id,
          p.test_id,
          p.role,
          p.status,
          p.display_name ?? null,
          p.dimension_scores ? JSON.stringify(p.dimension_scores) : null,
          p.session_token || p.id,
          p.created_at || new Date().toISOString(),
        ]
      );
    }

    // 3. Migrate Scenario Instances
    const instances = db.scenario_instances || [];
    console.log(`Migrating ${instances.length} scenario instances...`);
    for (const si of instances) {
      await client.query(
        `INSERT INTO scenario_instances (id, participant_id, sequence_index, slot_id, variant_id, rendered_scenario, chosen_option, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          si.id,
          si.participant_id,
          si.sequence_index,
          si.slot_id,
          si.variant_id,
          JSON.stringify(si.rendered_scenario),
          si.chosen_option ?? null,
          si.created_at || new Date().toISOString(),
        ]
      );
    }

    // 4. Migrate Comparisons
    const comparisons = db.comparisons || [];
    console.log(`Migrating ${comparisons.length} comparisons...`);
    for (const c of comparisons) {
      await client.query(
        `INSERT INTO comparisons (id, test_id, bond_score, strongest_dimension, most_different_dimension, friendship_type, narrative_summary, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          c.id,
          c.test_id,
          c.bond_score,
          c.strongest_dimension,
          c.most_different_dimension,
          c.friendship_type,
          c.narrative_summary,
          c.created_at || new Date().toISOString(),
        ]
      );
    }

    // 5. Migrate Events
    const events = db.events || [];
    console.log(`Migrating ${events.length} events...`);
    for (const e of events) {
      await client.query(
        `INSERT INTO events (id, event_type, test_id, participant_id, role, timestamp, created_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          e.id,
          e.event_type,
          e.test_id ?? null,
          e.participant_id ?? null,
          e.role ?? null,
          e.timestamp || e.created_at || new Date().toISOString(),
          e.created_at || new Date().toISOString(),
          e.metadata ? JSON.stringify(e.metadata) : null,
        ]
      );
    }

    await client.query("COMMIT");
    console.log("Migration complete!");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
