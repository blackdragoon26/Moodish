import crypto from "node:crypto";
import {
  getSecretSession,
  saveSecretSession,
  withAccountLock,
} from "./memory.mjs";
import { readTeam, advanceTeamSchedule } from "./team-service.mjs";
import {
  publishMeal,
  remindMeal,
  needsChannelUpdate,
} from "./team-channels.mjs";
export function authorizeTeamJob(value) {
  const expected = process.env.TEAM_JOBS_SECRET;
  if (!expected || expected.length < 32)
    throw Object.assign(new Error("Team scheduler secret is not configured"), {
      status: 503,
    });
  const a = crypto.createHash("sha256").update(expected).digest(),
    b = crypto
      .createHash("sha256")
      .update(String(value || ""))
      .digest();
  if (!crypto.timingSafeEqual(a, b))
    throw Object.assign(new Error("Invalid scheduler credential"), {
      status: 401,
    });
}
export async function runTeamJobs(base, { teamIds } = {}) {
  return withAccountLock(
    "team-jobs",
    async () => {
      const registry =
        teamIds || (await getSecretSession("teams-registry")) || [];
      const cursor = teamIds
        ? 0
        : (await getSecretSession("team-jobs-cursor"))?.offset || 0;
      const ordered = [...registry.slice(cursor), ...registry.slice(0, cursor)];
      const ids = teamIds ? ordered : ordered.slice(0, 20);
      if (!teamIds)
        await saveSecretSession("team-jobs-cursor", {
          offset: registry.length ? (cursor + ids.length) % registry.length : 0,
        });
      let created = 0,
        updated = 0;
      const errors = [];
      for (const teamId of ids) {
        try {
          if ((await advanceTeamSchedule(teamId)).created) created++;
          const team = await readTeam(teamId);
          if (!team) continue;
          const ownerId = Object.keys(team.members).find(
            (id) => team.members[id] === "owner",
          );
          for (const s of team.sessions) {
            for (const platform of [
              ...new Set([
                ...(s.publishTo || []),
                ...Object.keys(s.channelMessages || {}),
              ]),
            ])
              try {
                if (
                  !team.channels?.[platform]?.channelId ||
                  (s.channelMessages?.[platform]?.channelId &&
                    s.channelMessages[platform].channelId !==
                      team.channels[platform].channelId)
                )
                  continue;
                if (!needsChannelUpdate(teamId, s, platform, base)) continue;
                const result = await publishMeal(
                  teamId,
                  s.id,
                  ownerId,
                  platform,
                  base,
                );
                if (result.published) updated++;
              } catch {
                errors.push({ teamId, sessionId: s.id, step: "status" });
              }
            if (
              s.state === "collecting" &&
              s.deadline > Date.now() &&
              s.deadline - Date.now() <= 15 * 60000 &&
              process.env.WHATSAPP_REMINDER_TEMPLATE
            )
              try {
                await remindMeal(teamId, s.id, ownerId, base);
              } catch {
                errors.push({ teamId, sessionId: s.id, step: "reminder" });
              }
          }
        } catch {
          errors.push({ teamId, step: "schedule" });
        }
      }
      return { created, updated, errors };
    },
    { longRunning: true },
  );
}

export function startTeamWorker(base) {
  if (process.env.TEAM_JOBS_ENABLED !== "true") return () => {};
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await runTeamJobs(base);
      if (result.errors.length)
        console.error(
          "[Moodish Teams] Background tasks need attention",
          JSON.stringify(result.errors),
        );
    } catch (error) {
      console.error(
        "[Moodish Teams] Background tasks could not complete:",
        error.status || "unavailable",
      );
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 30000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
