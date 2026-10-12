// Decision support, never purchase authorization. Do not include individual
// responses, dietary text or capabilities in this shared workspace brief.
export function teamDecisionBrief(team, session, now = Date.now()) {
  const responses = Object.values(session.participants);
  const attending = responses.filter((p) => p.attendance === "join").length;
  const skipped = responses.filter((p) => p.attendance === "skip").length;
  const pending = responses.filter((p) => p.attendance === "pending").length;
  const perPerson = Math.min(
    session.budgetPerPerson,
    team.defaults.budgetPerPerson,
  );
  const cap =
    Math.round(Math.min(team.defaults.maxTotal, perPerson * attending) * 100) /
    100;
  const collecting = session.state === "collecting";
  const options = session.choices.map((choice) => {
    const fresh =
      Number.isFinite(choice.verifiedAt) &&
      now >= choice.verifiedAt &&
      now - choice.verifiedAt <= 15 * 60000;
    const withinBudget =
      Number.isFinite(choice.total) && choice.total > 0 && choice.total <= cap;
    return {
      id: choice.id,
      restaurant: choice.restaurant,
      total: choice.total,
      perPerson: attending
        ? Math.round((choice.total / attending) * 100) / 100
        : null,
      remainingBudget: Math.round((cap - choice.total) * 100) / 100,
      fresh,
      withinBudget,
      eligible:
        session.state === "review" && attending > 0 && fresh && withinBudget,
    };
  });
  const eligible = options
    .filter((option) => option.eligible)
    .sort((a, b) => a.total - b.total || a.id.localeCompare(b.id));
  const next =
    session.state === "cancelled"
      ? "This meal is cancelled; start a fresh invitation to arrange another."
      : !attending
        ? "Collect at least one attending response before choosing food."
        : collecting
          ? now >= session.deadline
            ? "Close responses to freeze attendance before reviewing choices."
            : "Collect responses until cutoff; choices are not ready for handoff."
          : session.state === "review"
            ? eligible.length
              ? "Compare checked options; the purchaser must explicitly confirm external checkout."
              : "Check availability, dietary coverage and a fresh all-in quote within the current cap."
            : session.state === "handoff_ready"
              ? "The assigned purchaser completes checkout externally; record the actual result."
              : session.state === "order_reported"
                ? "Spend is purchaser-reported, not provider-verified."
                : "This meal is cancelled; start a fresh invitation to arrange another.";
  return {
    attending,
    skipped,
    pending,
    // Capacity is a limit, not an invitation count: do not invent missing people.
    capacity: session.capacity,
    currentSpendCap: cap,
    options,
    lowestCheckedChoiceId: eligible[0]?.id || null,
    nextAction: next,
    caveat:
      "Checked by the organizer; no automatic order, dietary safety guarantee or combined delivery promise.",
  };
}
