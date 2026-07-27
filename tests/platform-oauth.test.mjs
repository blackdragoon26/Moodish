import test from "node:test";
import assert from "node:assert/strict";
import { startPlatformOAuth } from "../services/agent/src/platform-oauth.mjs";

test("platform manager OAuth starts with provider-specific identity scopes", () => {
  const previous = {
    SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
    SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
    TEAMS_APP_ID: process.env.TEAMS_APP_ID,
    TEAMS_CLIENT_SECRET: process.env.TEAMS_CLIENT_SECRET
  };
  Object.assign(process.env, {
    SLACK_CLIENT_ID: "slack-client",
    SLACK_CLIENT_SECRET: "slack-secret",
    DISCORD_CLIENT_ID: "discord-client",
    DISCORD_CLIENT_SECRET: "discord-secret",
    TEAMS_APP_ID: "teams-client",
    TEAMS_CLIENT_SECRET: "teams-secret"
  });
  try {
    const slack = new URL(startPlatformOAuth("slack", { sessionId: "group-1" }).authorizationUrl);
    const discord = new URL(startPlatformOAuth("discord", { sessionId: "group-1" }).authorizationUrl);
    const teams = new URL(startPlatformOAuth("teams", { sessionId: "group-1" }).authorizationUrl);
    assert.equal(slack.searchParams.get("user_scope"), "identity.basic");
    assert.equal(discord.searchParams.get("scope"), "identify");
    assert.match(teams.searchParams.get("scope"), /User\.Read/);
    assert.equal(teams.searchParams.get("code_challenge_method"), "S256");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
