import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadLocalEnv(cwd = process.cwd()) {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(cwd, file);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = unquote(trimmed.slice(index + 1).trim());
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
