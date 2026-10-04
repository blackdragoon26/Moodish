// Run once per minute with your process supervisor/cron. No secrets in argv.
const base = process.env.MOODISH_PUBLIC_URL;
const secret = process.env.TEAM_JOBS_SECRET;
if (!base || !secret)
  throw Error("MOODISH_PUBLIC_URL and TEAM_JOBS_SECRET are required");
const response = await fetch(new URL("/api/teams/jobs", base), {
  method: "POST",
  headers: {
    "x-moodish-jobs-secret": secret,
    "content-type": "application/json",
  },
  body: "{}",
  signal: AbortSignal.timeout(55000),
});
const result = await response.json();
if (!response.ok || result.errors?.length) {
  console.error("Team scheduler needs attention", JSON.stringify(result));
  process.exitCode = 1;
} else console.log(JSON.stringify(result));
