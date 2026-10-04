import { readTeam, requireRole } from "./team-service.mjs";
import { createToolRuntime } from "./tools.mjs";
import { planOfficeLunch } from "./recommender.mjs";
import { getSwiggyConnectionStatus } from "./swiggy-auth.mjs";
export async function suggestTeamMeals(teamId, sessionId, userId) {
  const team = await readTeam(teamId);
  requireRole(team, userId, ["owner", "purchaser"]);
  const session = team.sessions.find((s) => s.id === sessionId);
  if (!session || session.state !== "review")
    throw Object.assign(
      new Error("Close responses before discovering options"),
      { status: 409 },
    );
  if (process.env.SWIGGY_MODE !== "live")
    throw Object.assign(
      new Error(
        "Live restaurant discovery is not enabled. Add checked restaurant options manually.",
      ),
      { status: 503 },
    );
  const connection = await getSwiggyConnectionStatus(userId);
  if (!connection.connected || !connection.selectedAddressId)
    throw Object.assign(
      new Error(
        "Connect Swiggy and select this office’s saved delivery address in Moodish first.",
      ),
      { status: 422 },
    );
  const preferences = Object.values(session.participants)
    .filter((p) => p.attendance === "join")
    .map((p, index) => ({
      participantId: `person-${index}`,
      dietMode: p.dietMode,
      dietaryRules: p.dietaryRules
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      allergies: p.allergies
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      mood: p.craving,
    }));
  const runtime = createToolRuntime({ userId });
  const result = await planOfficeLunch({
    request: {
      addressId: connection.selectedAddressId,
      headcount: preferences.length,
      budgetPerPerson: session.budgetPerPerson,
      participantPreferences: preferences,
      query: session.vibe,
      includeInstamartAddOns: false,
    },
    teamProfile: {
      headcount: preferences.length,
      budgetPerPerson: session.budgetPerPerson,
      dietaryRules: [],
      cuisineAvoidList: [],
    },
    swiggy: runtime.swiggy,
    ai: runtime.ai,
  });
  return {
    message:
      "Live suggestions are estimates. Verify dietary coverage, availability and the all-in checkout price before saving options.",
    options: safeTeamSuggestions(
      result.options,
      preferences.length,
      Math.min(
        team.defaults.maxTotal,
        Math.min(session.budgetPerPerson, team.defaults.budgetPerPerson) *
          preferences.length,
      ),
    ),
    addressId: connection.selectedAddressId,
  };
}

// Coverage plans can change the primary restaurant while matching participants.
// Use the actual food source and omit partial/compromised plans from the shortlist.
export function safeTeamSuggestions(options, attendees, budget) {
  const seen = new Set();
  return options
    .filter(
      (o) =>
        !o.splitOrder &&
        o.foodSources?.length === 1 &&
        !o.instamartItems?.length &&
        o.coverage?.totalParticipants === attendees &&
        o.coverage.satisfiedCount === attendees &&
        !o.coverage.compromiseCount &&
        !o.coverage.unansweredCount &&
        o.coverage.withinBudget &&
        o.coverage.participants?.every(
          (p) => p.status === "satisfied" && p.source !== "unavailable",
        ) &&
        o.estimatedTotal > 0 &&
        o.estimatedTotal <= budget,
    )
    .map((o) => ({
      restaurant: o.foodSources[0].restaurantName,
      items: o.items.map((i) => `${i.quantity} × ${i.name}`).join(", "),
      estimatedTotal: o.estimatedTotal,
      coverage: `${attendees}/${attendees} participant requests matched; confirm restrictions with the restaurant`,
    }))
    .filter((o) => {
      const key = `${o.restaurant}:${o.items}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}
