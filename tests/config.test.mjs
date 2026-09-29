import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runtimeConfigProblems } from "../services/agent/src/config.mjs";

const strong = { TOKEN_ENCRYPTION_KEY: "e".repeat(40), GROUP_SESSION_SIGNING_KEY: "g".repeat(40) };
const production = { NODE_ENV: "production", SWIGGY_MODE: "live", DATABASE_URL: "postgresql://moodish:pw@db.internal:5432/moodish", MOODISH_PUBLIC_URL: "https://moodish.example", ...strong };

test("fixture deployments without Swiggy OAuth need no durable secrets", () => {
  assert.deepEqual(runtimeConfigProblems({ NODE_ENV: "production", SWIGGY_MODE: "fixture" }), []);
  assert.deepEqual(runtimeConfigProblems(production), []);
});

test("live or OAuth-enabled production names each unsafe setting without printing values", () => {
  const problems = runtimeConfigProblems({ NODE_ENV: "production", SWIGGY_MODE: "fixture", SWIGGY_OAUTH_ENABLED: "true",
    DATABASE_URL: "postgresql://moodish:super-secret@pooler.example:6543/moodish", TOKEN_ENCRYPTION_KEY: "short", GROUP_SESSION_SIGNING_KEY: "short", MOODISH_PUBLIC_URL: "http://localhost:8787" });
  const text = problems.join("\n");
  for (const expected of [/TOKEN_ENCRYPTION_KEY must be at least 32/, /must be different/, /public HTTPS origin/, /transaction-mode pooler/]) assert.match(text, expected);
  assert.equal(text.includes("super-secret"), false);
  assert.match(runtimeConfigProblems({ ...production, DATABASE_URL: "postgresql://h/db?pgbouncer=true" }).join(), /transaction-mode/);
  assert.match(runtimeConfigProblems({ ...production, DATABASE_URL: "" }).join(), /DATABASE_URL is required/);
  assert.match(runtimeConfigProblems({ SWIGGY_MODE: "production" }).join(), /fixture or live/);
});

test("the server process exits before listening when production configuration is unsafe", async () => {
  const server = new URL("../apps/web/server.mjs", import.meta.url).pathname;
  const env = { PATH: process.env.PATH, NODE_ENV: "production", SWIGGY_MODE: "live", PORT: "0", MOODISH_RUNTIME_ENV_FILE: "/nonexistent", DATABASE_URL: "postgresql://moodish:very-secret@db.example:6543/x" };
  const result = await promisify(execFile)(process.execPath, [server], { env, cwd: "/", timeout: 10000 }).then(() => ({ code: 0 }), error => error);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /TOKEN_ENCRYPTION_KEY is required/);
  assert.equal(result.stderr.includes("very-secret"), false);
});
