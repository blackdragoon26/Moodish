import crypto from "node:crypto";
import {
  getSecretSession,
  saveSecretSession,
  withAccountLock,
} from "./memory.mjs";

const id = () => crypto.randomUUID();
const hash = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");
const failure = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const text = (value, max = 160) =>
  String(value || "")
    .trim()
    .slice(0, max);
const integer = (value, min, max, name) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw failure(`${name} must be between ${min} and ${max}`);
  return n;
};
export const readTeam = async (teamId) => {
  const team = await getSecretSession(`teams:${teamId}`);
  return team ? structuredClone(team) : null;
};
const save = (team) => saveSecretSession(`teams:${team.id}`, team);
export function requireRole(
  team,
  userId,
  roles = ["owner", "organizer", "purchaser"],
) {
  if (!team || !roles.includes(team.members[userId]))
    throw failure("Workspace access required", 403);
}
function defaults(input = {}) {
  const result = {
    office: text(input.office),
    budgetPerPerson: integer(
      input.budgetPerPerson ?? 350,
      120,
      2000,
      "Per-person budget",
    ),
    maxTotal: integer(input.maxTotal ?? 8750, 120, 50000, "Meal budget"),
    headcount: integer(input.headcount ?? 10, 2, 25, "Headcount"),
    cutoffMinutes: integer(input.cutoffMinutes ?? 30, 5, 1440, "Cutoff"),
    vibe: text(input.vibe || "team lunch"),
  };
  if (result.headcount * result.budgetPerPerson > result.maxTotal)
    throw failure("The default headcount exceeds the total meal budget");
  return result;
}
export async function createTeam(user, input) {
  if ((await listTeams(user.id)).length >= 25)
    throw failure("Workspace limit reached", 409);
  const team = {
    id: id(),
    name: text(input.name),
    members: { [user.id]: "owner" },
    defaults: defaults(input),
    sessions: [],
    invites: {},
    createdAt: new Date().toISOString(),
  };
  if (!team.name || !team.defaults.office)
    throw failure("Workspace name and office are required");
  await save(team);
  await indexTeam(user.id, team.id);
  await withAccountLock("teams-registry", async () => {
    const ids = (await getSecretSession("teams-registry")) || [];
    ids.push(team.id);
    await saveSecretSession("teams-registry", ids);
  });
  return team;
}
async function indexTeam(userId, teamId) {
  return withAccountLock(`teams-index:${userId}`, async () => {
    const key = `teams-index:${userId}`,
      index = (await getSecretSession(key)) || [];
    if (!index.includes(teamId)) index.push(teamId);
    await saveSecretSession(key, index);
  });
}
export async function listTeams(userId) {
  const index = (await getSecretSession(`teams-index:${userId}`)) || [];
  const teams = await Promise.all(index.map(readTeam));
  return teams
    .filter((t) => t?.members[userId])
    .map((t) => ({ id: t.id, name: t.name, role: t.members[userId] }));
}
export function viewTeam(team, userId) {
  requireRole(team, userId);
  return {
    id: team.id,
    name: team.name,
    role: team.members[userId],
    defaults: team.defaults,
    members: team.members[userId] === "owner" ? team.members : undefined,
    schedule: team.schedule || null,
    sessions: team.sessions.map(sessionSummary),
    channels: Object.keys(team.channels || {}),
  };
}
export async function mutateTeam(teamId, userId, action, input = {}) {
  return withAccountLock(`teams:${teamId}`, async () => {
    const team = await readTeam(teamId);
    requireRole(team, userId);
    let result;
    if (action === "schedule") {
      requireRole(team, userId, ["owner", "organizer"]);
      if (input.enabled === false) team.schedule = null;
      else {
        const nextRun = Date.parse(input.nextRun);
        if (
          !Number.isFinite(nextRun) ||
          nextRun <= Date.now() ||
          nextRun > Date.now() + 31 * 86400000
        )
          throw failure("Choose a future start within 31 days");
        team.schedule = { nextRun, userId, enabled: true };
      }
    } else if (action === "settings") {
      requireRole(team, userId, ["owner"]);
      const changed = defaults({ ...team.defaults, ...input });
      if (!changed.office) throw failure("Office is required");
      team.defaults = changed;
      if (input.name !== undefined) {
        if (!text(input.name)) throw failure("Name required");
        team.name = text(input.name);
      }
    } else if (action === "invite") {
      requireRole(team, userId, ["owner"]);
      if (!["organizer", "purchaser"].includes(input.role))
        throw failure("Choose organizer or purchaser");
      const token = crypto.randomBytes(24).toString("base64url");
      team.invites = Object.fromEntries(
        Object.entries(team.invites).filter(
          ([, v]) => v.expiresAt > Date.now(),
        ),
      );
      if (Object.keys(team.invites).length >= 30)
        throw failure("Too many pending invitations", 409);
      team.invites[hash(token)] = {
        role: input.role,
        expiresAt: Date.now() + 86400000,
      };
      result = { token };
    } else if (action === "disconnect") {
      requireRole(team, userId, ["owner"]);
      if (!["slack", "discord"].includes(input.platform))
        throw failure("Choose Slack or Discord");
      const c = team.channels?.[input.platform];
      if (c?.channelId) {
        const key = `team-channel:${input.platform}:${c.workspaceId}:${c.channelId}`;
        await withAccountLock(key, async () => {
          const binding = await getSecretSession(key);
          if (binding?.teamId === team.id) await saveSecretSession(key, null);
        });
      }
      delete team.channels?.[input.platform];
      for (const session of team.sessions)
        session.publishTo = (session.publishTo || []).filter(
          (p) => p !== input.platform,
        );
    } else if (action === "remove-member") {
      requireRole(team, userId, ["owner"]);
      if (team.members[input.userId] === "owner")
        throw failure("The owner cannot be removed");
      delete team.members[input.userId];
      if (team.schedule?.userId === input.userId) team.schedule = null;
      for (const [key, invitation] of Object.entries(team.invites))
        if (invitation.acceptedBy === input.userId) delete team.invites[key];
    } else if (action === "create-meal" || action === "repeat") {
      requireRole(team, userId, ["owner", "organizer"]);
      const previous = action === "repeat" ? meal(team, input.sessionId) : null;
      const session = makeSession(team, userId, input, previous);
      team.sessions.unshift(session);
      result = { ...sessionSummary(session), shareToken: session.shareToken };
    } else throw failure("Unknown workspace action", 404);
    await save(team);
    return result || viewTeam(team, userId);
  });
}
export async function acceptTeamInvite(teamId, userId, token) {
  await withAccountLock(`teams:${teamId}`, async () => {
    const team = await readTeam(teamId),
      invite = team?.invites[hash(token)];
    if (
      !invite ||
      invite.expiresAt <= Date.now() ||
      (invite.acceptedBy &&
        (invite.acceptedBy !== userId || !team.members[userId]))
    )
      throw failure("Invitation expired or already used", 403);
    if (!team.members[userId]) team.members[userId] = invite.role;
    invite.acceptedBy = userId;
    await save(team);
  });
  await indexTeam(userId, teamId);
  return { joined: true };
}
function meal(team, sessionId) {
  const session = team.sessions.find((s) => s.id === sessionId);
  if (!session) throw failure("Meal not found", 404);
  return session;
}
export function sessionSummary(s) {
  return {
    id: s.id,
    state:
      s.state === "collecting" && Date.now() >= s.deadline
        ? "responses_closed"
        : s.state,
    office: s.office,
    capacity: s.capacity,
    budgetPerPerson: s.budgetPerPerson,
    vibe: s.vibe,
    deadline: s.deadline,
    deliveryTime: s.deliveryTime,
    attending: Object.values(s.participants).filter(
      (p) => p.attendance === "join",
    ).length,
    skipped: Object.values(s.participants).filter(
      (p) => p.attendance === "skip",
    ).length,
    choices: s.choices,
    selectedChoiceId: s.selectedChoiceId,
    handoff: s.handoff,
    order: s.order,
    createdAt: s.createdAt,
  };
}
export async function mealView(teamId, sessionId, userId) {
  const team = await readTeam(teamId);
  requireRole(team, userId);
  const s = meal(team, sessionId);
  return {
    ...sessionSummary(s),
    shareToken: s.shareToken,
    events: s.events,
    responses: Object.values(s.participants).map((p) => ({
      name: p.name,
      attendance: p.attendance,
    })),
  };
}
function authorizeShare(session, token) {
  const a = Buffer.from(hash(session.shareToken)),
    b = Buffer.from(hash(token));
  if (!crypto.timingSafeEqual(a, b))
    throw failure("This participation link is invalid", 403);
}
export async function participantAction(
  teamId,
  sessionId,
  token,
  action = "view",
  input = {},
) {
  return withAccountLock(`teams:${teamId}`, async () => {
    const team = await readTeam(teamId);
    if (!team) throw failure("Meal not found", 404);
    const s = meal(team, sessionId);
    authorizeShare(s, token);
    let participant = input.participantToken
      ? s.participants[hash(input.participantToken)]
      : null;
    let issued;
    if (action === "respond") {
      if (s.state !== "collecting" || Date.now() >= s.deadline)
        throw failure("Responses are closed", 409);
      if (!["join", "skip"].includes(input.attendance))
        throw failure("Choose join or skip");
      if (!text(input.name, 60)) throw failure("Your name is required");
      if (!participant && Object.keys(s.participants).length >= 100)
        throw failure("Response limit reached", 409);
      if (
        input.attendance === "join" &&
        participant?.attendance !== "join" &&
        sessionSummary(s).attending >= s.capacity
      )
        throw failure("This meal is full", 409);
      if (!participant) {
        issued = crypto.randomBytes(24).toString("base64url");
        participant = {};
        s.participants[hash(issued)] = participant;
      }
      Object.assign(participant, {
        name: text(input.name, 60),
        attendance: input.attendance,
        dietMode: ["veg", "non_veg", "both"].includes(input.dietMode)
          ? input.dietMode
          : "both",
        dietaryRules: text(input.dietaryRules, 300),
        allergies: text(input.allergies, 300),
        craving: text(input.craving),
        muted: input.muted === true,
        respondedAt: Date.now(),
      });
      await save(team);
    } else if (action === "forget") {
      if (!participant)
        throw failure("Your private response token is required", 403);
      if (!["collecting", "cancelled"].includes(s.state))
        throw failure(
          "Ask the organizer to cancel the meal before deleting a closed response",
          409,
        );
      delete s.participants[hash(input.participantToken)];
      for (const [key, subscriber] of Object.entries(s.whatsapp || {}))
        if (subscriber.participantHash === hash(input.participantToken))
          delete s.whatsapp[key];
      participant = null;
      await save(team);
    } else if (action !== "view")
      throw failure("Unknown participation action", 404);
    return {
      ...sessionSummary(s),
      office: undefined,
      handoff: undefined,
      order: s.order
        ? { total: s.order.total, verification: s.order.verification }
        : undefined,
      canRespond: s.state === "collecting" && Date.now() < s.deadline,
      mine: participant
        ? {
            name: participant.name,
            attendance: participant.attendance,
            dietMode: participant.dietMode,
            dietaryRules: participant.dietaryRules,
            allergies: participant.allergies,
            craving: participant.craving,
            muted: participant.muted,
          }
        : null,
      participantToken: issued,
    };
  });
}
export async function mealAction(
  teamId,
  sessionId,
  userId,
  action,
  input = {},
) {
  return withAccountLock(`teams:${teamId}`, async () => {
    const team = await readTeam(teamId);
    requireRole(team, userId);
    const s = meal(team, sessionId);
    if (action === "close") {
      requireRole(team, userId, ["owner", "organizer"]);
      if (s.state !== "collecting")
        throw failure("Collection is already closed", 409);
      if (!sessionSummary(s).attending)
        throw failure("At least one participant must join", 409);
      s.state = "review";
    } else if (action === "choices") {
      requireRole(team, userId, ["owner", "organizer"]);
      if (s.state !== "review")
        throw failure("Close collection before adding options", 409);
      if (
        !Array.isArray(input.choices) ||
        input.choices.length < 1 ||
        input.choices.length > 3
      )
        throw failure("Provide one to three restaurant options");
      s.choices = input.choices.map((c) => {
        const total = Number(c.total);
        if (
          !text(c.restaurant) ||
          !text(c.items, 1000) ||
          !Number.isFinite(total) ||
          total <= 0 ||
          total > s.budgetPerPerson * sessionSummary(s).attending ||
          total > team.defaults.maxTotal
        )
          throw failure(
            "Every option needs a restaurant, items and an in-budget all-in total",
          );
        let url;
        try {
          url = new URL(c.url);
        } catch {
          throw failure("Use an HTTPS restaurant link");
        }
        if (url.protocol !== "https:" || url.username || url.password)
          throw failure("Use an HTTPS restaurant link");
        if (c.coverageConfirmed !== true)
          throw failure(
            "Check dietary coverage with participants before adding an option",
          );
        return {
          id: id(),
          restaurant: text(c.restaurant),
          items: text(c.items, 1000),
          total: Math.round(total * 100) / 100,
          url: url.toString(),
          coverage: "Organizer checked with participants",
          source: "organizer",
          verifiedAt: Date.now(),
        };
      });
    } else if (action === "handoff") {
      requireRole(team, userId, ["owner", "purchaser"]);
      if (s.state === "handoff_ready" && s.selectedChoiceId === input.choiceId)
        return sessionSummary(s);
      if (s.state !== "review")
        throw failure("Meal is not ready for review", 409);
      const choice = s.choices.find((c) => c.id === input.choiceId);
      if (!choice || input.confirmed !== true)
        throw failure("Select and explicitly confirm an option");
      if (Date.now() - choice.verifiedAt > 15 * 60000)
        throw failure(
          "Refresh availability and the all-in price before approval",
          409,
        );
      if (
        choice.total > team.defaults.maxTotal ||
        choice.total >
          Math.min(s.budgetPerPerson, team.defaults.budgetPerPerson) *
            sessionSummary(s).attending
      )
        throw failure(
          "Current workspace budget does not permit this option",
          409,
        );
      s.selectedChoiceId = choice.id;
      s.state = "handoff_ready";
      s.handoff = {
        ...choice,
        purchaserId: userId,
        at: Date.now(),
        message:
          "Open the restaurant link and complete checkout. No cart or order has been created by Moodish.",
      };
    } else if (action === "record-order") {
      requireRole(team, userId, ["owner", "purchaser"]);
      if (s.state === "order_reported") {
        if (s.handoff.purchaserId !== userId || input.confirmed !== true)
          throw failure("Only the assigned purchaser can report checkout", 403);
        return sessionSummary(s);
      }
      if (
        s.state !== "handoff_ready" ||
        s.handoff.purchaserId !== userId ||
        input.confirmed !== true
      )
        throw failure("Only the assigned purchaser can report checkout", 403);
      const total = Number(input.total);
      if (
        !Number.isFinite(total) ||
        total <= 0 ||
        total >
          Math.min(
            team.defaults.maxTotal,
            Math.min(s.budgetPerPerson, team.defaults.budgetPerPerson) *
              sessionSummary(s).attending,
          )
      )
        throw failure("Actual total exceeds the meal budget");
      if (!text(input.reference)) throw failure("Order reference required");
      s.state = "order_reported";
      s.order = {
        total,
        reference: text(input.reference),
        at: Date.now(),
        verification: "Reported by purchaser; not verified with provider",
      };
    } else if (action === "cancel") {
      requireRole(team, userId, ["owner", "organizer"]);
      if (["handoff_ready", "order_reported"].includes(s.state))
        throw failure(
          "Checkout may have started. Contact the purchaser and provider; Moodish cannot cancel it.",
          409,
        );
      s.state = "cancelled";
    } else throw failure("Unknown meal action", 404);
    s.events.push({ type: action, at: Date.now(), actor: userId });
    await save(team);
    return sessionSummary(s);
  });
}
export async function reportTeam(teamId, userId) {
  const team = await readTeam(teamId);
  requireRole(team, userId, ["owner"]);
  const rows = team.sessions.map((s) => ({
    meal: s.id,
    created: new Date(s.createdAt).toISOString(),
    state: s.state,
    attendees: sessionSummary(s).attending,
    estimatedTotal: s.handoff?.total || 0,
    reportedSpend: s.order?.total || 0,
    verification: s.order?.verification || "No purchase reported",
  }));
  return {
    sessions: rows,
    reportedSpend: rows.reduce((n, r) => n + r.reportedSpend, 0),
    repeatedSessions: team.sessions.filter((s) =>
      s.events.some((e) => e.type === "repeat"),
    ).length,
  };
}

function makeSession(team, userId, input, previous = null) {
  if (team.sessions.length >= 1000)
    throw failure("Workspace session limit reached", 409);

  const options = {
    ...team.defaults,
    ...(previous
      ? {
          vibe: previous.vibe,
          budgetPerPerson: previous.budgetPerPerson,
          headcount: previous.capacity,
        }
      : {}),
    ...input,
  };
  const capacity = integer(options.headcount, 2, 25, "Headcount");
  const budget = integer(
    options.budgetPerPerson,
    120,
    team.defaults.budgetPerPerson,
    "Per-person budget",
  );
  if (capacity * budget > team.defaults.maxTotal)
    throw failure("This meal exceeds the workspace budget");
  const deadline = input.deadline
    ? Date.parse(input.deadline)
    : Date.now() + team.defaults.cutoffMinutes * 60000;
  if (
    !Number.isFinite(deadline) ||
    deadline <= Date.now() ||
    deadline > Date.now() + 31 * 86400000
  )
    throw failure("Choose a future cutoff within 31 days");
  const delivery = input.deliveryTime ? Date.parse(input.deliveryTime) : null;
  if (delivery !== null && (!Number.isFinite(delivery) || delivery <= deadline))
    throw failure("Delivery must be after the response cutoff");
  const session = {
    id: id(),
    creatorId: userId,
    state: "collecting",
    office: team.defaults.office,
    capacity,
    budgetPerPerson: budget,
    vibe: text(options.vibe || "team lunch"),
    deadline,
    deliveryTime: delivery,
    participants: {},
    choices: [],
    selectedChoiceId: null,
    publishTo:
      input.publish === true
        ? Object.keys(team.channels || {}).filter(
            (p) => team.channels[p].channelId,
          )
        : [],
    shareToken: crypto.randomBytes(24).toString("base64url"),
    createdAt: Date.now(),
    events: [{ type: previous ? "repeat" : "created", at: Date.now() }],
  };

  return session;
}

// Meal creation and the next weekly run are persisted in one workspace write.
// A process crash can retry safely without creating a second invitation.
export async function advanceTeamSchedule(teamId, now = Date.now()) {
  return withAccountLock(`teams:${teamId}`, async () => {
    const team = await readTeam(teamId);
    if (!team) return { created: false };
    let created = false,
      changed = false;
    if (team.schedule?.enabled && team.schedule.nextRun <= now) {
      try {
        requireRole(team, team.schedule.userId, ["owner", "organizer"]);
        const session = makeSession(team, team.schedule.userId, {
          publish: true,
        });
        team.sessions.unshift(session);
        const week = 7 * 86400000;
        team.schedule.nextRun +=
          (Math.floor((now - team.schedule.nextRun) / week) + 1) * week;
        delete team.schedule.claimedAt;
        created = true;
        changed = true;
      } catch (error) {
        team.schedule.enabled = false;
        team.schedule.error =
          "Weekly invitations stopped. Check organizer access and office defaults, then reschedule.";
        changed = true;
      }
    }
    for (const session of team.sessions) {
      if (session.state === "collecting" && session.deadline <= now) {
        session.state = sessionSummary(session).attending
          ? "review"
          : "cancelled";
        session.events.push({ type: "cutoff", at: now });
        changed = true;
      }
    }
    if (changed) await save(team);
    return { created };
  });
}
