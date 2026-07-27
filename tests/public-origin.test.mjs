import test from "node:test";
import assert from "node:assert/strict";
import { resolvePublicOrigin } from "../services/agent/src/public-origin.mjs";

test("production forwarded origin replaces a stale localhost callback setting", () => {
  const previousPublicUrl = process.env.MOODISH_PUBLIC_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.MOODISH_PUBLIC_URL = "http://localhost:8787";
  process.env.NODE_ENV = "production";
  try {
    const origin = resolvePublicOrigin({
      headers: {
        host: "moodish-internal:10000",
        "x-forwarded-host": "moodish.onrender.com",
        "x-forwarded-proto": "https"
      },
      socket: {}
    });
    assert.equal(origin, "https://moodish.onrender.com");
  } finally {
    restore("MOODISH_PUBLIC_URL", previousPublicUrl);
    restore("NODE_ENV", previousNodeEnv);
  }
});

test("configured non-local origin cannot be overridden by an untrusted host header", () => {
  const previousPublicUrl = process.env.MOODISH_PUBLIC_URL;
  process.env.MOODISH_PUBLIC_URL = "https://moodish.onrender.com";
  try {
    assert.equal(
      resolvePublicOrigin({
        headers: { host: "attacker.example", "x-forwarded-proto": "https" },
        socket: {}
      }),
      "https://moodish.onrender.com"
    );
  } finally {
    restore("MOODISH_PUBLIC_URL", previousPublicUrl);
  }
});

test("local development preserves its actual port", () => {
  const previousPublicUrl = process.env.MOODISH_PUBLIC_URL;
  delete process.env.MOODISH_PUBLIC_URL;
  try {
    assert.equal(resolvePublicOrigin({ headers: { host: "127.0.0.1:8792" }, socket: {} }), "http://127.0.0.1:8792");
  } finally {
    restore("MOODISH_PUBLIC_URL", previousPublicUrl);
  }
});

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
