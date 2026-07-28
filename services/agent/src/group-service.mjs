import crypto from "node:crypto";
import { makeRecommendationId, normalizeList, nowIso } from "./contracts.mjs";
import { getGroupSession, logAudit, saveGroupSession } from "./memory.mjs";
import { buildConfirmedCart, planOfficeLunch } from "./recommender.mjs";

const STATES = new Set([
  "collecting",
  "locked",
  "ranking",
  "voting",
  "awaiting_manager",
  "awaiting_creator_confirmation",
  "cart_built",
  "expired",
  "cancelled"
]);
const PLATFORMS = new Set(["web", "slack", "teams", "discord"]);
const APPROVAL_MODES = new Set(["manager_decides", "team_vote", "automatic"]);

export async function createGroupSession(args = {}) {
  const now = nowIso();
  const creatorId = required(args.creatorId, "creatorId");
  const invitePasscode = createInvitePasscode();
  const invitePasscodeSalt = crypto.randomBytes(16).toString("hex");
  const session = {
    sessionId: makeRecommendationId("group"),
    platform: PLATFORMS.has(args.platform) ? args.platform : "web",
    workspaceId: String(args.workspaceId || "web"),
    channelId: String(args.channelId || "private"),
    creatorId,
    invitePasscodeHash: hashInvitePasscode(invitePasscode, invitePasscodeSalt),
    invitePasscodeSalt,
    coManagerIds: unique(args.coManagerIds),
    headcount: bounded(args.headcount, 2, 500, 6),
    responseDeadline: args.responseDeadline || new Date(Date.now() + 30 * 60_000).toISOString(),
    budgetPerPerson: bounded(args.budgetPerPerson, 120, 2000, 350),
    totalBudget: null,
    desiredDeliveryTime: args.desiredDeliveryTime || null,
    vibe: String(args.vibe || "team meal"),
    servingStyle: args.servingStyle === "shared" ? "shared" : "individual",
    approvalMode: APPROVAL_MODES.has(args.approvalMode) ? args.approvalMode : "manager_decides",
    state: "collecting",
    submissions: {},
    votes: {},
    recommendation: null,
    selectedOptionId: null,
    cart: null,
    createdAt: now,
    updatedAt: now
  };
  session.totalBudget = session.headcount * session.budgetPerPerson;
  await saveGroupSession(session);
  await logAudit("group_session_created", {
    sessionId: session.sessionId,
    platform: session.platform,
    workspaceId: session.workspaceId
  });
  return { ...privateSessionView(session), invitePasscode };
}

export async function submitGroupPreference(args = {}) {
  const session = await requireSession(args.sessionId);
  requireInvitePasscode(session, args.invitePasscode, args.bypassInvitePasscode);
  assertState(session, "collecting");
  expireIfNeeded(session);
  assertState(session, "collecting");
  const participantId = required(args.participantId, "participantId");
  session.submissions[participantId] = {
    participantId,
    dietMode: normalizeDietMode(args.dietMode),
    dietaryRules: cleanRules(args.dietaryRules),
    allergies: cleanRules(args.allergies),
    mood: String(args.mood || "").trim(),
    discoveryMode: ["comfort", "balanced", "explore"].includes(args.discoveryMode)
      ? args.discoveryMode
      : "balanced",
    submittedAt: nowIso()
  };
  session.updatedAt = nowIso();
  await saveGroupSession(session);
  await logAudit("group_preference_submitted", { sessionId: session.sessionId, participantIdHash: safeActor(participantId) });
  return publicSessionView(session);
}

export async function lockAndRankGroupSession(args = {}, runtime) {
  const session = await requireSession(args.sessionId);
  requireManager(session, args.actorId);
  assertState(session, "collecting");
  expireIfNeeded(session);
  assertState(session, "collecting");
  session.state = "locked";
  session.updatedAt = nowIso();
  await saveGroupSession(session);

  session.state = "ranking";
  await saveGroupSession(session);
  const aggregate = aggregatePreferences(session);
  const recommendation = await planOfficeLunch({
    request: {
      headcount: Math.max(Object.keys(session.submissions).length, session.headcount),
      budgetPerPerson: session.budgetPerPerson,
      query: [session.vibe, ...aggregate.moods].filter(Boolean).join(" "),
      dietMode: aggregate.dietMode,
      dietaryRules: aggregate.sharedRules,
      allergies: aggregate.allergies,
      vegCount: aggregate.vegCount,
      nonVegCount: aggregate.nonVegCount,
      bothCount: aggregate.bothCount,
      includeInstamartAddOns: true
    },
    teamProfile: {
      headcount: session.headcount,
      budgetPerPerson: session.budgetPerPerson,
      dietaryRules: [],
      cuisineAvoidList: []
    },
    swiggy: runtime.swiggy,
    ai: runtime.ai
  });
  session.recommendation = recommendation;
  if (session.approvalMode === "automatic") {
    session.selectedOptionId = recommendation.options[0]?.optionId || null;
    session.state = "awaiting_creator_confirmation";
  } else if (session.approvalMode === "team_vote") {
    session.state = "voting";
  } else {
    session.state = "awaiting_manager";
  }
  session.updatedAt = nowIso();
  await saveGroupSession(session);
  await logAudit("group_session_ranked", { sessionId: session.sessionId, approvalMode: session.approvalMode });
  return privateSessionView(session);
}

export async function voteGroupOption(args = {}) {
  const session = await requireSession(args.sessionId);
  requireInvitePasscode(session, args.invitePasscode, args.bypassInvitePasscode);
  assertState(session, "voting");
  const participantId = required(args.participantId, "participantId");
  const optionId = validOption(session, args.optionId);
  session.votes[participantId] = { optionId, votedAt: nowIso() };
  session.updatedAt = nowIso();
  await saveGroupSession(session);
  return publicSessionView(session);
}

export async function selectGroupOption(args = {}) {
  const session = await requireSession(args.sessionId);
  requireManager(session, args.actorId);
  if (!["awaiting_manager", "voting"].includes(session.state)) {
    throw stateError(`Cannot select an option while session is ${session.state}`);
  }
  session.selectedOptionId =
    args.optionId || (session.state === "voting" ? winningVoteOption(session) : session.recommendation?.options[0]?.optionId);
  validOption(session, session.selectedOptionId);
  session.state = "awaiting_creator_confirmation";
  session.updatedAt = nowIso();
  await saveGroupSession(session);
  await logAudit("group_option_selected", { sessionId: session.sessionId, optionId: session.selectedOptionId });
  return privateSessionView(session);
}

export async function confirmGroupCart(args = {}, runtime) {
  const session = await requireSession(args.sessionId);
  if (String(args.actorId) !== session.creatorId) {
    const error = new Error("Only the session creator can confirm the Swiggy cart");
    error.status = 403;
    throw error;
  }
  assertState(session, "awaiting_creator_confirmation");
  if (args.confirmed !== true) throw stateError("Explicit creator confirmation is required");
  session.cart = await buildConfirmedCart({
    recommendation: session.recommendation,
    optionId: session.selectedOptionId,
    swiggy: runtime.swiggy,
    confirmed: true
  });
  session.state = "cart_built";
  session.updatedAt = nowIso();
  await saveGroupSession(session);
  await logAudit("group_cart_built", { sessionId: session.sessionId });
  return privateSessionView(session);
}

export async function getGroupSessionView(args = {}) {
  const session = await requireSession(args.sessionId);
  expireIfNeeded(session);
  await saveGroupSession(session);
  if (isManager(session, args.actorId)) return privateSessionView(session);
  return publicSessionView(session);
}

export async function verifyGroupInviteAccess(args = {}) {
  const session = await requireSession(args.sessionId);
  requireInvitePasscode(session, args.invitePasscode, false);
  return publicSessionView(session);
}

export async function cancelGroupSession(args = {}) {
  const session = await requireSession(args.sessionId);
  requireManager(session, args.actorId);
  if (["cart_built", "cancelled", "expired"].includes(session.state)) throw stateError(`Cannot cancel ${session.state} session`);
  session.state = "cancelled";
  session.updatedAt = nowIso();
  await saveGroupSession(session);
  return privateSessionView(session);
}

export function publicSessionView(session) {
  const aggregate = aggregatePreferences(session);
  return {
    sessionId: session.sessionId,
    platform: session.platform,
    workspaceId: session.workspaceId,
    channelId: session.channelId,
    state: session.state,
    headcount: session.headcount,
    responseCount: Object.keys(session.submissions).length,
    responseDeadline: session.responseDeadline,
    budgetPerPerson: session.budgetPerPerson,
    totalBudget: session.totalBudget,
    vibe: session.vibe,
    servingStyle: session.servingStyle,
    approvalMode: session.approvalMode,
    invitePasscodeRequired: true,
    aggregate: {
      vegCount: aggregate.vegCount,
      nonVegCount: aggregate.nonVegCount,
      bothCount: aggregate.bothCount,
      restrictionCounts: aggregate.restrictionCounts,
      allergySubmissionCount: aggregate.allergySubmissionCount
    },
    options: session.recommendation?.options?.map((option) => ({
      optionId: option.optionId,
      restaurantName: option.restaurantName,
      cuisine: option.cuisine,
      estimatedTotal: option.estimatedTotal,
      items: option.items.map((item) => ({ name: item.name, quantity: item.quantity }))
    })),
    voteCounts: voteCounts(session),
    selectedOptionId: session.selectedOptionId,
    updatedAt: session.updatedAt
  };
}

function privateSessionView(session) {
  return {
    ...publicSessionView(session),
    creatorId: session.creatorId,
    coManagerIds: session.coManagerIds,
    submissions: Object.values(session.submissions),
    recommendation: session.recommendation,
    cart: session.cart
  };
}

function aggregatePreferences(session) {
  const submissions = Object.values(session.submissions);
  const vegCount = submissions.filter((item) => item.dietMode === "veg").length;
  const nonVegCount = submissions.filter((item) => item.dietMode === "non_veg").length;
  const bothCount = submissions.filter((item) => item.dietMode === "both").length;
  const restrictions = submissions.flatMap((item) => item.dietaryRules);
  const restrictionCounts = Object.fromEntries([...new Set(restrictions)].map((rule) => [rule, restrictions.filter((x) => x === rule).length]));
  return {
    vegCount,
    nonVegCount,
    bothCount,
    dietMode: vegCount > 0 && nonVegCount === 0 ? "veg" : "both",
    sharedRules: [...new Set(restrictions.filter((rule) => restrictions.filter((item) => item === rule).length === submissions.length))],
    allergies: [...new Set(submissions.flatMap((item) => item.allergies))],
    allergySubmissionCount: submissions.filter((item) => item.allergies.length).length,
    restrictionCounts,
    moods: submissions.map((item) => item.mood).filter(Boolean)
  };
}

function winningVoteOption(session) {
  const counts = voteCounts(session);
  return [...(session.recommendation?.options || [])]
    .sort((a, b) => (counts[b.optionId] || 0) - (counts[a.optionId] || 0) || b.score - a.score)[0]?.optionId;
}

function voteCounts(session) {
  const counts = {};
  for (const vote of Object.values(session.votes)) counts[vote.optionId] = (counts[vote.optionId] || 0) + 1;
  return counts;
}

function validOption(session, optionId) {
  if (!session.recommendation?.options?.some((option) => option.optionId === optionId)) {
    const error = new Error("Unknown group recommendation option");
    error.status = 404;
    throw error;
  }
  return optionId;
}

async function requireSession(sessionId) {
  const session = await getGroupSession(required(sessionId, "sessionId"));
  if (!session) {
    const error = new Error("Unknown group session");
    error.status = 404;
    throw error;
  }
  return session;
}

function requireManager(session, actorId) {
  if (!isManager(session, actorId)) {
    const error = new Error("Creator or co-manager access is required");
    error.status = 403;
    throw error;
  }
}

function isManager(session, actorId) {
  return String(actorId || "") === session.creatorId || session.coManagerIds.includes(String(actorId || ""));
}

function assertState(session, expected) {
  if (session.state !== expected) throw stateError(`Expected ${expected} session, received ${session.state}`);
}

function expireIfNeeded(session) {
  if (session.state === "collecting" && Date.parse(session.responseDeadline) <= Date.now()) {
    session.state = "expired";
    session.updatedAt = nowIso();
  }
}

function stateError(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

function required(value, name) {
  if (value === undefined || value === null || String(value).trim() === "") {
    const error = new Error(`${name} is required`);
    error.status = 400;
    throw error;
  }
  return String(value);
}

function bounded(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function unique(values) {
  return [...new Set(normalizeList(values))];
}

function cleanRules(values) {
  return unique(values)
    .map((value) => value.toLowerCase())
    .filter((value) => value !== "none");
}

function normalizeDietMode(value) {
  if (value === "veg" || value === "non_veg") return value;
  return "both";
}

function safeActor(value) {
  return `participant:${String(value).length}`;
}

function createInvitePasscode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(8), (byte) => alphabet[byte % alphabet.length]).join("");
}

function hashInvitePasscode(passcode, salt) {
  return crypto.scryptSync(String(passcode).trim().toUpperCase(), salt, 32).toString("hex");
}

function requireInvitePasscode(session, passcode, bypass) {
  if (bypass === true) return;
  const supplied = String(passcode || "").trim().toUpperCase();
  if (!supplied) {
    const error = new Error("Team passcode is required");
    error.status = 401;
    throw error;
  }
  const expected = Buffer.from(session.invitePasscodeHash || "", "hex");
  const actual = Buffer.from(hashInvitePasscode(supplied, session.invitePasscodeSalt), "hex");
  if (!expected.length || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    const error = new Error("Incorrect team passcode");
    error.status = 403;
    throw error;
  }
}

export { STATES as GROUP_SESSION_STATES };
