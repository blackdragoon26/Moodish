import { DEFAULT_USER_HASH, nowIso } from "./contracts.mjs";

const userProfiles = new Map();
const teamProfiles = new Map();
const recommendations = new Map();
const feedbackEvents = [];
const auditLogs = [];

const defaultTasteProfile = {
  userIdHash: DEFAULT_USER_HASH,
  spiceTolerance: 3,
  noveltyPreference: 4,
  likedCuisines: ["South Indian", "Thai", "Bengali", "Lebanese"],
  dislikedIngredients: ["mushroom"],
  dietaryRules: ["high-protein"],
  weeklyCuisineHistory: ["North Indian", "Biryani"],
  budgetComfort: 350,
  updatedAt: nowIso()
};

const defaultTeamProfile = {
  teamId: "team-demo",
  name: "Demo Product Pod",
  headcount: 6,
  budgetPerPerson: 250,
  dietaryRules: ["veg", "high-protein"],
  cuisineAvoidList: ["North Indian"],
  spiceTolerance: 2,
  updatedAt: nowIso()
};

userProfiles.set(DEFAULT_USER_HASH, defaultTasteProfile);
teamProfiles.set(defaultTeamProfile.teamId, defaultTeamProfile);

export function getTasteProfile(userIdHash = DEFAULT_USER_HASH) {
  return userProfiles.get(userIdHash) ?? { ...defaultTasteProfile, userIdHash };
}

export function updateTasteProfile(userIdHash = DEFAULT_USER_HASH, patch = {}) {
  const current = getTasteProfile(userIdHash);
  const updated = { ...current, ...patch, userIdHash, updatedAt: nowIso() };
  userProfiles.set(userIdHash, updated);
  logAudit("taste_profile_updated", { userIdHash });
  return updated;
}

export function getTeamProfile(teamId = "team-demo") {
  return teamProfiles.get(teamId) ?? { ...defaultTeamProfile, teamId };
}

export function updateTeamProfile(teamId = "team-demo", patch = {}) {
  const current = getTeamProfile(teamId);
  const updated = { ...current, ...patch, teamId, updatedAt: nowIso() };
  teamProfiles.set(teamId, updated);
  logAudit("team_profile_updated", { teamId });
  return updated;
}

export function saveRecommendation(run) {
  recommendations.set(run.recommendationId, run);
  logAudit("recommendation_saved", {
    recommendationId: run.recommendationId,
    mode: run.mode
  });
  return run;
}

export function getRecommendation(recommendationId) {
  return recommendations.get(recommendationId);
}

export function recordFeedback(event) {
  const stored = { ...event, createdAt: nowIso() };
  feedbackEvents.push(stored);
  logAudit("feedback_recorded", {
    orderId: stored.orderId,
    rating: stored.rating
  });
  return stored;
}

export function exportTasteMemory(userIdHash = DEFAULT_USER_HASH) {
  return {
    profile: getTasteProfile(userIdHash),
    feedback: feedbackEvents.filter((event) => event.userIdHash === userIdHash),
    exportedAt: nowIso()
  };
}

export function deleteTasteMemory(userIdHash = DEFAULT_USER_HASH) {
  userProfiles.delete(userIdHash);
  logAudit("taste_memory_deleted", { userIdHash });
  return { deleted: true, userIdHash };
}

export function clearTeamHistory(teamId = "team-demo") {
  const current = getTeamProfile(teamId);
  const updated = { ...current, cuisineAvoidList: [], updatedAt: nowIso() };
  teamProfiles.set(teamId, updated);
  logAudit("team_history_cleared", { teamId });
  return updated;
}

export function logAudit(event, details = {}) {
  auditLogs.push({ ts: nowIso(), event, details });
}

export function getAuditLogs() {
  return [...auditLogs].slice(-100);
}
