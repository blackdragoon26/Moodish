// A small, predictable command parser. Ambiguous scheduling stays in the office
// dashboard instead of silently assuming a delivery time or purchasing food.
export function parseTeamCommand(command, now = Date.now()) {
  const text = String(command || "").trim();
  if (!/^(?:team\s+)?lunch\b/i.test(text)) return null;
  const result = { vibe: text === "lunch" ? "team lunch" : text };
  const people = text.match(
    /\bfor\s+(\d+)\b|\b(\d+)\s+(?:people|persons|teammates)\b/i,
  );
  const price = text.match(/(?:₹|\b(?:rs\.?|inr)\s*)(\d+)(?:\b|\s)/i);
  if (people) result.headcount = Number(people[1] || people[2]);
  if (price) result.budgetPerPerson = Number(price[1]);
  const time = text.match(
    /\b(?:delivery|deliver|arrive)\s*(?:at|around|by)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i,
  );
  if (time) {
    let hour = Number(time[1]),
      minute = Number(time[2] || 0);
    if (hour > 23 || minute > 59 || (time[3] && (hour < 1 || hour > 12)))
      throw Object.assign(new Error("Choose a valid delivery time"), {
        status: 400,
      });
    if (time[3]) hour = (hour % 12) + (time[3].toLowerCase() === "pm" ? 12 : 0);
    const offset = 330 * 60000,
      local = new Date(now + offset);
    let day = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
    );
    const weekday = text.match(
      /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    );
    if (/\btomorrow\b/i.test(text)) day += 86400000;
    else if (weekday) {
      const target = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ].indexOf(weekday[1].toLowerCase());
      day += ((target - local.getUTCDay() + 7) % 7) * 86400000;
    }
    const delivery = day + hour * 3600000 + minute * 60000 - offset;
    if (delivery <= now + 5 * 60000)
      throw Object.assign(
        new Error(
          "Choose a future delivery time or open the workspace to set the schedule",
        ),
        { status: 400 },
      );
    result.deliveryTime = new Date(delivery).toISOString();
    result.deadline = new Date(delivery - 30 * 60000).toISOString();
    if (Date.parse(result.deadline) <= now)
      throw Object.assign(
        new Error("Allow at least 30 minutes for meal responses"),
        { status: 400 },
      );
  } else if (
    /\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|tomorrow|delivery|deliver|arrive|at|around|by)\b/i.test(
      text,
    )
  )
    throw Object.assign(
      new Error(
        "Include an explicit delivery time, for example: lunch Friday ₹350 delivery 1pm. Times use Asia/Kolkata.",
      ),
      { status: 400 },
    );
  return result;
}
