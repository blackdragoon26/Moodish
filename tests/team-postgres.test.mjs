import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
const execute = promisify(execFile),
  database = process.env.MOODISH_TEST_DATABASE_URL;
const skip = !database;
const service = new URL(
  "../services/agent/src/team-service.mjs",
  import.meta.url,
).href;
const memory = new URL("../services/agent/src/memory.mjs", import.meta.url)
  .href;
const run = async (script) => {
  const { stdout } = await execute(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {createTeam,mutateTeam,participantAction,readTeam,advanceTeamSchedule,listTeams,mealView} from ${JSON.stringify(service)};import {saveSecretSession} from ${JSON.stringify(memory)};${script};process.exit(0);`,
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: database,
        NODE_ENV: "test",
        SWIGGY_MODE: "fixture",
        MOODISH_RUNTIME_ENV_FILE: "/nonexistent",
      },
      timeout: 30000,
    },
  );
  return JSON.parse(stdout.trim().split("\n").at(-1));
};
test(
  "team attendance, private capabilities and identities survive replicas without lost updates",
  { skip },
  async () => {
    const user = crypto.randomUUID();
    const f = await run(
      `const t=await createTeam({id:${JSON.stringify(user)}},{name:'Replica office',office:'Private Office',headcount:2});const s=await mutateTeam(t.id,${JSON.stringify(user)},'create-meal',{});console.log(JSON.stringify({teamId:t.id,sessionId:s.id,token:s.shareToken}));`,
    );
    const args = [f.teamId, f.sessionId, f.token].map(JSON.stringify).join(",");
    const responses = await Promise.all(
      ["A", "B"].map((name) =>
        run(
          `console.log(JSON.stringify(await participantAction(${args},'respond',{name:${JSON.stringify(name)},attendance:'join',allergies:'private-note'})));`,
        ),
      ),
    );
    const stored = await run(
      `console.log(JSON.stringify(await participantAction(${args},'view',{participantToken:${JSON.stringify(responses[0].participantToken)}})));`,
    );
    assert.equal(stored.attending, 2);
    assert.equal(stored.mine.name, "A");
    assert.equal(stored.mine.allergies, "private-note");
    const publicView = await run(
      `console.log(JSON.stringify(await participantAction(${args})));`,
    );
    assert.ok(!JSON.stringify(publicView).includes("private-note"));
    const index = await run(
      `console.log(JSON.stringify(await listTeams(${JSON.stringify(user)})));`,
    );
    assert.ok(index.some((t) => t.id === f.teamId));
  },
);
test(
  "concurrent weekly workers commit one new meal and advance next run together",
  { skip },
  async () => {
    const user = crypto.randomUUID();
    const teamId = await run(
      `const t=await createTeam({id:${JSON.stringify(user)}},{name:'Weekly office',office:'Office',headcount:2});await mutateTeam(t.id,${JSON.stringify(user)},'schedule',{nextRun:new Date(Date.now()+10000).toISOString()});const saved=await readTeam(t.id);saved.schedule.nextRun=Date.now()-1000;await saveSecretSession('teams:'+t.id,saved);console.log(JSON.stringify(t.id));`,
    );
    const args = JSON.stringify(teamId);
    const results = await Promise.all([
      run(`console.log(JSON.stringify(await advanceTeamSchedule(${args})));`),
      run(`console.log(JSON.stringify(await advanceTeamSchedule(${args})));`),
    ]);
    assert.equal(results.filter((r) => r.created).length, 1);
    const state = await run(
      `console.log(JSON.stringify(await readTeam(${args})));`,
    );
    assert.equal(state.sessions.length, 1);
    assert.equal(state.sessions[0].state, "collecting");
    assert.ok(state.schedule.nextRun > Date.now());
    assert.equal(state.sessions[0].handoff, undefined);
  },
);
