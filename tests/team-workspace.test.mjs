import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  createTeam,
  mutateTeam,
  participantAction,
  mealAction,
  mealView,
  viewTeam,
  readTeam,
  acceptTeamInvite,
  reportTeam,
  listTeams,
} from "../services/agent/src/team-service.mjs";
import {
  getSecretSession,
  saveSecretSession,
} from "../services/agent/src/memory.mjs";
import {
  runTeamJobs,
  authorizeTeamJob,
} from "../services/agent/src/team-jobs.mjs";
const fixture = async () => {
  const owner = { id: crypto.randomUUID() };
  const t = await createTeam(owner, {
    name: "Office",
    office: "Private address",
    headcount: 3,
  });
  const s = await mutateTeam(t.id, owner.id, "create-meal", {});
  return { owner, t, s };
};
const join = (f, input = {}) =>
  participantAction(f.t.id, f.s.id, f.s.shareToken, "respond", {
    name: "A",
    attendance: "join",
    allergies: "private peanut note",
    ...input,
  });

test("workspace identity and manager invitations are isolated and consumed once", async () => {
  const f = await fixture();
  assert.throws(() => viewTeam(f.t, "attacker"), { status: 403 });
  await assert.rejects(mutateTeam(f.t.id, "attacker", "settings", {}), {
    status: 403,
  });
  const invitation = await mutateTeam(f.t.id, f.owner.id, "invite", {
    role: "organizer",
  });
  const other = crypto.randomUUID();
  await acceptTeamInvite(f.t.id, other, invitation.token);
  assert.deepEqual(await acceptTeamInvite(f.t.id, other, invitation.token), {
    joined: true,
  });
  await assert.rejects(acceptTeamInvite(f.t.id, "stranger", invitation.token), {
    status: 403,
  });
  assert.equal((await listTeams(other)).length, 1);
  await assert.rejects(mutateTeam(f.t.id, other, "settings", {}), {
    status: 403,
  });
  await assert.rejects(mutateTeam(f.t.id, other, "invite", { role: "owner" }), {
    status: 403,
  });
});
test("private participation tokens prevent response replacement and public dietary disclosure", async () => {
  const f = await fixture();
  await assert.rejects(
    participantAction(f.t.id, f.s.id, "wrong", "respond", {}),
    { status: 403 },
  );
  const a = await join(f);
  assert.ok(a.participantToken);
  assert.equal(a.mine.allergies, "private peanut note");
  const publicView = await participantAction(f.t.id, f.s.id, f.s.shareToken);
  assert.equal(publicView.mine, null);
  assert.equal(publicView.office, undefined);
  assert.ok(!JSON.stringify(publicView).includes("private peanut"));
  const b = await join(f, { name: "A", allergies: "other" });
  assert.notEqual(a.participantToken, b.participantToken);
  await join(f, { participantToken: a.participantToken, attendance: "skip" });
  const mine = await participantAction(f.t.id, f.s.id, f.s.shareToken, "view", {
    participantToken: b.participantToken,
  });
  assert.equal(mine.mine.attendance, "join");
  assert.ok(
    !JSON.stringify(await mealView(f.t.id, f.s.id, f.owner.id)).includes(
      "private peanut",
    ),
  );
});
test("capacity, cutoff, actual attendance and workspace spend caps are enforced", async () => {
  const f = await fixture();
  await assert.rejects(
    mutateTeam(f.t.id, f.owner.id, "create-meal", {
      headcount: 25,
      budgetPerPerson: 1000,
    }),
    { status: 400 },
  );
  await assert.rejects(
    mutateTeam(f.t.id, f.owner.id, "create-meal", { deadline: "bad" }),
    { status: 400 },
  );
  await Promise.all([join(f), join(f), join(f)]);
  await assert.rejects(join(f), { status: 409 });
  await mealAction(f.t.id, f.s.id, f.owner.id, "close");
  await assert.rejects(join(f), { status: 409 });
  await assert.rejects(
    mealAction(f.t.id, f.s.id, f.owner.id, "choices", {
      choices: [
        {
          restaurant: "R",
          items: "3 meals",
          url: "https://example.com",
          total: 1100,
          coverageConfirmed: true,
        },
      ],
    }),
    { status: 400 },
  );
});
test("manual handoff requires purchaser, current checked quote, confirmation and is idempotent", async () => {
  const f = await fixture();
  await join(f);
  await mealAction(f.t.id, f.s.id, f.owner.id, "close");
  const ranked = await mealAction(f.t.id, f.s.id, f.owner.id, "choices", {
    choices: [
      {
        restaurant: "R",
        items: "One bowl",
        url: "https://example.com",
        total: 300,
        coverageConfirmed: true,
      },
    ],
  });
  const c = ranked.choices[0];
  await assert.rejects(
    mealAction(f.t.id, f.s.id, f.owner.id, "handoff", { choiceId: c.id }),
    { status: 400 },
  );
  const inv = await mutateTeam(f.t.id, f.owner.id, "invite", {
    role: "organizer",
  });
  await acceptTeamInvite(f.t.id, "organizer-" + f.t.id, inv.token);
  await assert.rejects(
    mealAction(f.t.id, f.s.id, "organizer-" + f.t.id, "handoff", {
      choiceId: c.id,
      confirmed: true,
    }),
    { status: 403 },
  );
  const h = await mealAction(f.t.id, f.s.id, f.owner.id, "handoff", {
    choiceId: c.id,
    confirmed: true,
  });
  assert.equal(h.state, "handoff_ready");
  assert.match(h.handoff.message, /No cart or order/);
  assert.deepEqual(
    await mealAction(f.t.id, f.s.id, f.owner.id, "handoff", {
      choiceId: c.id,
      confirmed: true,
    }),
    h,
  );
  await assert.rejects(
    mealAction(f.t.id, f.s.id, f.owner.id, "record-order", {
      total: 500,
      reference: "x",
      confirmed: true,
    }),
    { status: 400 },
  );
  await mealAction(f.t.id, f.s.id, f.owner.id, "record-order", {
    total: 310,
    reference: "ref",
    confirmed: true,
  });
  assert.equal((await reportTeam(f.t.id, f.owner.id)).reportedSpend, 310);
});
test("repeat clears attendance, choices and purchase while retaining budget", async () => {
  const f = await fixture();
  await join(f);
  const next = await mutateTeam(f.t.id, f.owner.id, "repeat", {
    sessionId: f.s.id,
  });
  assert.equal(next.attending, 0);
  assert.equal(next.choices.length, 0);
  assert.notEqual(next.shareToken, f.s.shareToken);
  assert.equal(next.handoff, undefined);
  assert.equal((await reportTeam(f.t.id, f.owner.id)).repeatedSessions, 1);
});
test("closed response deletion fails explicitly; device response deletion works during collection", async () => {
  const f = await fixture();
  const a = await join(f);
  await participantAction(f.t.id, f.s.id, f.s.shareToken, "forget", {
    participantToken: a.participantToken,
  });
  assert.equal(
    (await participantAction(f.t.id, f.s.id, f.s.shareToken)).attending,
    0,
  );
});
test("weekly jobs claim once, create a fresh invitation and do not purchase", async () => {
  const f = await fixture();
  await mutateTeam(f.t.id, f.owner.id, "schedule", {
    nextRun: new Date(Date.now() + 10000).toISOString(),
  });
  const t = await readTeam(f.t.id);
  t.schedule.nextRun = Date.now() - 100;
  await saveSecretSession(`teams:${t.id}`, t);
  await Promise.all([
    runTeamJobs("https://example.com", { teamIds: [t.id] }),
    runTeamJobs("https://example.com", { teamIds: [t.id] }),
  ]);
  const after = await readTeam(t.id);
  assert.equal(after.sessions.length, 2);
  assert.equal(after.sessions[0].state, "collecting");
  assert.equal(after.sessions[0].handoff, undefined);
  process.env.TEAM_JOBS_SECRET =
    "scheduler-test-secret-of-at-least-32-characters";
  assert.throws(() => authorizeTeamJob("wrong"), { status: 401 });
  authorizeTeamJob(process.env.TEAM_JOBS_SECRET);
});

test("cutoff atomically closes attendance without ordering and permits manager review", async () => {
  const { advanceTeamSchedule } =
    await import("../services/agent/src/team-service.mjs");
  const f = await fixture();
  await join(f);
  const t = await readTeam(f.t.id);
  t.sessions[0].deadline = Date.now() - 1;
  await saveSecretSession(`teams:${t.id}`, t);
  await advanceTeamSchedule(t.id);
  const after = await readTeam(t.id);
  assert.equal(after.sessions[0].state, "review");
  assert.equal(after.sessions[0].handoff, undefined);
  await assert.rejects(join(f), { status: 409 });
});
test("lowered workspace caps apply to saved quotes and unknown menu URLs produce a useful error", async () => {
  const f = await fixture();
  await join(f);
  await mealAction(f.t.id, f.s.id, f.owner.id, "close");
  await assert.rejects(
    mealAction(f.t.id, f.s.id, f.owner.id, "choices", {
      choices: [
        {
          restaurant: "R",
          items: "Bowl",
          url: "bad-url",
          total: 300,
          coverageConfirmed: true,
        },
      ],
    }),
    { status: 400 },
  );
  const choices = await mealAction(f.t.id, f.s.id, f.owner.id, "choices", {
    choices: [
      {
        restaurant: "R",
        items: "Bowl",
        url: "https://example.com",
        total: 300,
        coverageConfirmed: true,
      },
    ],
  });
  await mutateTeam(f.t.id, f.owner.id, "settings", { budgetPerPerson: 250 });
  await assert.rejects(
    mealAction(f.t.id, f.s.id, f.owner.id, "handoff", {
      choiceId: choices.choices[0].id,
      confirmed: true,
    }),
    { status: 409 },
  );
});

test("removing a member revokes old invite capabilities and their weekly schedule", async () => {
  const f = await fixture(),
    organizer = "org-" + f.t.id;
  const invitation = await mutateTeam(f.t.id, f.owner.id, "invite", {
    role: "organizer",
  });
  await acceptTeamInvite(f.t.id, organizer, invitation.token);
  await mutateTeam(f.t.id, organizer, "schedule", {
    nextRun: new Date(Date.now() + 10000).toISOString(),
  });
  await mutateTeam(f.t.id, f.owner.id, "remove-member", { userId: organizer });
  await assert.rejects(acceptTeamInvite(f.t.id, organizer, invitation.token), {
    status: 403,
  });
  assert.equal((await readTeam(f.t.id)).schedule, null);
});
test("a revoked or invalid schedule cannot prevent cutoff processing for other meals", async () => {
  const { advanceTeamSchedule } =
    await import("../services/agent/src/team-service.mjs");
  const f = await fixture();
  await join(f);
  const t = await readTeam(f.t.id);
  t.schedule = {
    enabled: true,
    userId: "revoked-user",
    nextRun: Date.now() - 100,
  };
  t.sessions[0].deadline = Date.now() - 10;
  await saveSecretSession(`teams:${t.id}`, t);
  await advanceTeamSchedule(t.id);
  const after = await readTeam(t.id);
  assert.equal(after.schedule.enabled, false);
  assert.equal(after.sessions[0].state, "review");
});
