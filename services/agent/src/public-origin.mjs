const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function resolvePublicOrigin(req) {
  const incoming = incomingOrigin(req);
  const configured = configuredOrigin();
  if (!configured) return incoming;

  const configuredUrl = new URL(configured);
  const incomingUrl = new URL(incoming);
  const configuredIsLocal = LOCAL_HOSTS.has(configuredUrl.hostname);
  const incomingIsLocal = LOCAL_HOSTS.has(incomingUrl.hostname);

  // A stale localhost Render variable must never pull a production OAuth callback
  // back to the developer machine.
  if (configuredIsLocal && !incomingIsLocal) return incoming;
  return configured;
}

function configuredOrigin() {
  const value = String(process.env.MOODISH_PUBLIC_URL || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function incomingOrigin(req) {
  const forwardedHost = firstHeader(req.headers["x-forwarded-host"]);
  const host = forwardedHost || firstHeader(req.headers.host);
  if (!host || !/^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.test(host)) {
    const error = new Error("A valid request host is required for OAuth");
    error.status = 400;
    throw error;
  }
  const forwardedProto = firstHeader(req.headers["x-forwarded-proto"]);
  const protocol = ["http", "https"].includes(forwardedProto)
    ? forwardedProto
    : process.env.NODE_ENV === "production"
      ? "https"
      : req.socket?.encrypted
        ? "https"
        : "http";
  return `${protocol}://${host}`;
}

function firstHeader(value = "") {
  return String(Array.isArray(value) ? value[0] : value)
    .split(",")[0]
    .trim()
    .toLowerCase();
}
