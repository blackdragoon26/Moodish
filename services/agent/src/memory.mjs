import pg from "pg";
import { DEFAULT_USER_HASH, nowIso } from "./contracts.mjs";
import { loadLocalEnv } from "./env.mjs";

const { Pool } = pg;
loadLocalEnv();
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined
    })
  : null;

const userProfiles = new Map();
const teamProfiles = new Map();
const recommendations = new Map();
const feedbackEvents = [];
const mealHistoryEvents = [];
const groupSessions = new Map();
const platformEvents = new Map();
const secretSessions = new Map();
const auditLogs = [];
let schemaReady;

const blankTasteProfile = (userIdHash = DEFAULT_USER_HASH) => ({
  userIdHash,
  spiceTolerance: null,
  likedCuisines: [],
  dislikedIngredients: [],
  dietaryRules: [],
  weeklyCuisineHistory: [],
  recentMeals: [],
  budgetComfort: 350,
  createdAt: nowIso(),
  updatedAt: nowIso()
});

const defaultTeamProfile = {
  teamId: "team-fixture",
  name: "Demo Product Pod",
  headcount: 6,
  budgetPerPerson: 250,
  dietaryRules: ["veg", "high-protein"],
  cuisineAvoidList: [],
  spiceTolerance: 2,
  updatedAt: nowIso()
};

teamProfiles.set(defaultTeamProfile.teamId, defaultTeamProfile);

export async function getTasteProfile(userIdHash = DEFAULT_USER_HASH) {
  if (pool) {
    await ensureSchema();
    const result = await pool.query("SELECT data FROM moodish_profiles WHERE user_id_hash = $1", [userIdHash]);
    if (result.rows[0]) return result.rows[0].data;
  }
  return userProfiles.get(userIdHash) ?? blankTasteProfile(userIdHash);
}

export async function updateTasteProfile(userIdHash = DEFAULT_USER_HASH, patch = {}) {
  const current = await getTasteProfile(userIdHash);
  const updated = { ...current, ...patch, userIdHash, updatedAt: nowIso() };
  userProfiles.set(userIdHash, updated);
  if (pool) {
    await ensureSchema();
    await pool.query(
      `INSERT INTO moodish_profiles (user_id_hash, data, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id_hash) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [userIdHash, JSON.stringify(updated)]
    );
  }
  await logAudit("taste_profile_updated", { userIdHash });
  return updated;
}

export async function getTeamProfile(teamId = "team-fixture") {
  return teamProfiles.get(teamId) ?? { ...defaultTeamProfile, teamId };
}

export async function updateTeamProfile(teamId = "team-fixture", patch = {}) {
  const current = await getTeamProfile(teamId);
  const updated = { ...current, ...patch, teamId, updatedAt: nowIso() };
  teamProfiles.set(teamId, updated);
  await logAudit("team_profile_updated", { teamId });
  return updated;
}

export async function saveRecommendation(run) {
  recommendations.set(run.recommendationId, run);
  if (pool) {
    await ensureSchema();
    await pool.query(
      `INSERT INTO moodish_recommendations (recommendation_id, data, created_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (recommendation_id) DO UPDATE SET data = EXCLUDED.data`,
      [run.recommendationId, JSON.stringify(run)]
    );
  }
  await logAudit("recommendation_saved", { recommendationId: run.recommendationId, mode: run.mode });
  return run;
}

export async function getRecommendation(recommendationId) {
  if (recommendations.has(recommendationId)) return recommendations.get(recommendationId);
  if (pool) {
    await ensureSchema();
    const result = await pool.query("SELECT data FROM moodish_recommendations WHERE recommendation_id = $1", [
      recommendationId
    ]);
    return result.rows[0]?.data;
  }
  return undefined;
}

export async function recordFeedback(event) {
  const stored = { ...event, createdAt: nowIso() };
  feedbackEvents.push(stored);
  if (pool) {
    await ensureSchema();
    await pool.query("INSERT INTO moodish_feedback (user_id_hash, data, created_at) VALUES ($1, $2::jsonb, NOW())", [
      stored.userIdHash,
      JSON.stringify(stored)
    ]);
  }
  await logAudit("feedback_recorded", { orderId: stored.orderId, rating: stored.rating });
  return stored;
}

export async function recordMealHistory(event) {
  const stored = {
    ...event,
    userIdHash: event.userIdHash || DEFAULT_USER_HASH,
    items: Array.isArray(event.items) ? event.items : [],
    addOns: Array.isArray(event.addOns) ? event.addOns : [],
    confirmedAt: event.confirmedAt || nowIso()
  };
  const existingInMemory = mealHistoryEvents.find(
    (item) => item.userIdHash === stored.userIdHash && item.recommendationId === stored.recommendationId
  );
  if (existingInMemory) return existingInMemory;
  if (pool) {
    await ensureSchema();
    const existing = await pool.query(
      "SELECT data FROM moodish_meal_history WHERE user_id_hash = $1 AND data->>'recommendationId' = $2 LIMIT 1",
      [stored.userIdHash, stored.recommendationId]
    );
    if (existing.rows[0]) return existing.rows[0].data;
  }
  mealHistoryEvents.unshift(stored);
  if (pool) {
    await pool.query(
      "INSERT INTO moodish_meal_history (user_id_hash, data, confirmed_at) VALUES ($1, $2::jsonb, $3)",
      [stored.userIdHash, JSON.stringify(stored), stored.confirmedAt]
    );
  }
  const profile = await getTasteProfile(stored.userIdHash);
  const recentCuisines = [
    stored.cuisine,
    ...(profile.weeklyCuisineHistory || [])
  ].filter(Boolean).slice(0, 12);
  await updateTasteProfile(stored.userIdHash, {
    weeklyCuisineHistory: recentCuisines,
    recentMeals: [stored, ...(profile.recentMeals || [])].slice(0, 6)
  });
  await logAudit("meal_history_recorded", {
    userIdHash: stored.userIdHash,
    recommendationId: stored.recommendationId,
    restaurantName: stored.restaurantName
  });
  return stored;
}

export async function getMealHistory(userIdHash = DEFAULT_USER_HASH, limit = 6) {
  if (pool) {
    await ensureSchema();
    const result = await pool.query(
      "SELECT data FROM moodish_meal_history WHERE user_id_hash = $1 ORDER BY confirmed_at DESC LIMIT $2",
      [userIdHash, Math.max(1, Math.min(30, Number(limit) || 6))]
    );
    return result.rows.map((row) => row.data);
  }
  return mealHistoryEvents.filter((event) => event.userIdHash === userIdHash).slice(0, limit);
}

export async function exportTasteMemory(userIdHash = DEFAULT_USER_HASH) {
  let feedback = feedbackEvents.filter((event) => event.userIdHash === userIdHash);
  if (pool) {
    await ensureSchema();
    const result = await pool.query("SELECT data FROM moodish_feedback WHERE user_id_hash = $1 ORDER BY created_at DESC", [
      userIdHash
    ]);
    feedback = result.rows.map((row) => row.data);
  }
  return { profile: await getTasteProfile(userIdHash), feedback, exportedAt: nowIso() };
}

export async function deleteTasteMemory(userIdHash = DEFAULT_USER_HASH) {
  userProfiles.delete(userIdHash);
  for (let index = feedbackEvents.length - 1; index >= 0; index -= 1) {
    if (feedbackEvents[index].userIdHash === userIdHash) feedbackEvents.splice(index, 1);
  }
  for (let index = mealHistoryEvents.length - 1; index >= 0; index -= 1) {
    if (mealHistoryEvents[index].userIdHash === userIdHash) mealHistoryEvents.splice(index, 1);
  }
  if (pool) {
    await ensureSchema();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM moodish_profiles WHERE user_id_hash = $1", [userIdHash]);
      await client.query("DELETE FROM moodish_feedback WHERE user_id_hash = $1", [userIdHash]);
      await client.query("DELETE FROM moodish_meal_history WHERE user_id_hash = $1", [userIdHash]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  await logAudit("taste_memory_deleted", { userIdHash });
  return { deleted: true, userIdHash };
}

export async function clearTeamHistory(teamId = "team-fixture") {
  const current = await getTeamProfile(teamId);
  const updated = { ...current, cuisineAvoidList: [], updatedAt: nowIso() };
  teamProfiles.set(teamId, updated);
  await logAudit("team_history_cleared", { teamId });
  return updated;
}

export async function saveGroupSession(session) {
  groupSessions.set(session.sessionId, session);
  if (pool) {
    await ensureSchema();
    await pool.query(
      `INSERT INTO moodish_group_sessions (session_id, state, data, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (session_id) DO UPDATE SET state = EXCLUDED.state, data = EXCLUDED.data, updated_at = NOW()`,
      [session.sessionId, session.state, JSON.stringify(session)]
    );
  }
  return session;
}

export async function getGroupSession(sessionId) {
  if (groupSessions.has(sessionId)) return groupSessions.get(sessionId);
  if (pool) {
    await ensureSchema();
    const result = await pool.query("SELECT data FROM moodish_group_sessions WHERE session_id = $1", [sessionId]);
    return result.rows[0]?.data;
  }
  return undefined;
}

export async function getPlatformEventResponse(eventKey) {
  if (platformEvents.has(eventKey)) return platformEvents.get(eventKey);
  if (pool) {
    await ensureSchema();
    const result = await pool.query("SELECT response FROM moodish_platform_events WHERE event_key = $1", [eventKey]);
    return result.rows[0]?.response;
  }
  return undefined;
}

export async function savePlatformEventResponse(eventKey, response) {
  platformEvents.set(eventKey, response);
  if (pool) {
    await ensureSchema();
    await pool.query(
      `INSERT INTO moodish_platform_events (event_key, response, created_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (event_key) DO NOTHING`,
      [eventKey, JSON.stringify(response)]
    );
  }
  return response;
}

export async function getSecretSession(sessionKey) {
  if (secretSessions.has(sessionKey)) return secretSessions.get(sessionKey);
  if (pool) {
    await ensureSchema();
    const result = await pool.query("SELECT data FROM moodish_secret_sessions WHERE session_key = $1", [sessionKey]);
    return result.rows[0]?.data;
  }
  return undefined;
}

export async function saveSecretSession(sessionKey, data) {
  secretSessions.set(sessionKey, data);
  if (pool) {
    await ensureSchema();
    await pool.query(
      `INSERT INTO moodish_secret_sessions (session_key, data, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (session_key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [sessionKey, JSON.stringify(data)]
    );
  }
  return data;
}

export async function logAudit(event, details = {}) {
  const log = { ts: nowIso(), event, details };
  auditLogs.push(log);
  if (pool) {
    await ensureSchema();
    await pool.query("INSERT INTO moodish_audit_logs (event, details, created_at) VALUES ($1, $2::jsonb, NOW())", [
      event,
      JSON.stringify(details)
    ]);
  }
}

export async function getAuditLogs() {
  if (pool) {
    await ensureSchema();
    const result = await pool.query(
      "SELECT created_at AS ts, event, details FROM moodish_audit_logs ORDER BY created_at DESC LIMIT 100"
    );
    return result.rows;
  }
  return [...auditLogs].slice(-100);
}

async function ensureSchema() {
  if (!pool) return;
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS moodish_profiles (
        user_id_hash TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS moodish_recommendations (
        recommendation_id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS moodish_feedback (
        id BIGSERIAL PRIMARY KEY,
        user_id_hash TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS moodish_meal_history (
        id BIGSERIAL PRIMARY KEY,
        user_id_hash TEXT NOT NULL,
        data JSONB NOT NULL,
        confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS moodish_meal_history_user_time
        ON moodish_meal_history (user_id_hash, confirmed_at DESC);
      CREATE TABLE IF NOT EXISTS moodish_group_sessions (
        session_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS moodish_audit_logs (
        id BIGSERIAL PRIMARY KEY,
        event TEXT NOT NULL,
        details JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS moodish_platform_events (
        event_key TEXT PRIMARY KEY,
        response JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS moodish_secret_sessions (
        session_key TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }
  await schemaReady;
}
