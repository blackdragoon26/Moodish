// Startup checks for settings whose absence would otherwise surface only when a
// user reaches OAuth or a cart. Messages name settings, never their values.
export function runtimeConfigProblems(env = process.env) {
  const problems = [];
  const mode = env.SWIGGY_MODE || "fixture";
  if (!["fixture", "live"].includes(mode)) problems.push("SWIGGY_MODE must be fixture or live");
  const needsDurableSecrets = env.NODE_ENV === "production" && (mode === "live" || env.SWIGGY_OAUTH_ENABLED === "true");
  if (!needsDurableSecrets) return problems;
  for (const name of ["DATABASE_URL", "TOKEN_ENCRYPTION_KEY", "GROUP_SESSION_SIGNING_KEY", "MOODISH_PUBLIC_URL"]) {
    if (!String(env[name] || "").trim()) problems.push(`${name} is required when Swiggy OAuth or live mode is enabled in production`);
  }
  for (const name of ["TOKEN_ENCRYPTION_KEY", "GROUP_SESSION_SIGNING_KEY"]) {
    if (env[name] && env[name].length < 32) problems.push(`${name} must be at least 32 characters`);
  }
  if (env.TOKEN_ENCRYPTION_KEY && env.TOKEN_ENCRYPTION_KEY === env.GROUP_SESSION_SIGNING_KEY) problems.push("TOKEN_ENCRYPTION_KEY and GROUP_SESSION_SIGNING_KEY must be different");
  if (env.MOODISH_PUBLIC_URL) {
    try {
      const url = new URL(env.MOODISH_PUBLIC_URL);
      if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) problems.push("MOODISH_PUBLIC_URL must be the public HTTPS origin");
    } catch { problems.push("MOODISH_PUBLIC_URL is not a valid URL"); }
  }
  if (env.DATABASE_URL) {
    try {
      const url = new URL(env.DATABASE_URL);
      // Account and cart locks are session advisory locks; a transaction-mode
      // pooler can run the lock and unlock on different server sessions.
      if (url.port === "6543" || url.searchParams.get("pgbouncer") === "true") problems.push("DATABASE_URL must be a direct or session-pooled PostgreSQL connection, not a transaction-mode pooler");
    } catch { problems.push("DATABASE_URL is not a valid connection URL"); }
  }
  return problems;
}

export function assertRuntimeConfig(env = process.env) {
  const problems = runtimeConfigProblems(env);
  if (problems.length) throw new Error(`Moodish cannot start:\n- ${problems.join("\n- ")}`);
}
