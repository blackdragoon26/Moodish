const $ = (s) => document.querySelector(s),
  params = new URLSearchParams(location.search),
  fragment = new URLSearchParams(location.hash.slice(1));
const teamId = params.get("team"),
  mealId = params.get("meal");
let team,
  session,
  channels,
  choiceCount = 0;
const joinKey = `moodish:join:${teamId}:${mealId}`,
  participantKey = `moodish:participant:${teamId}:${mealId}`;
let joinToken = fragment.get("join") || sessionStorage.getItem(joinKey),
  participantToken =
    fragment.get("participant") || localStorage.getItem(participantKey);
if (fragment.get("join")) sessionStorage.setItem(joinKey, joinToken);
if (fragment.get("participant"))
  localStorage.setItem(participantKey, participantToken);
const inviteKey = `moodish:workspace-invite:${teamId}`;
const inviteToken = fragment.get("invite") || sessionStorage.getItem(inviteKey);
if (fragment.get("invite")) sessionStorage.setItem(inviteKey, inviteToken);
if (location.hash)
  history.replaceState(null, "", location.pathname + location.search);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (v) => new Date(v).toLocaleString();
const localDate = (v) => {
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const formData = (f) => Object.fromEntries(new FormData(f));
function status(message) {
  $("#status").textContent = message;
}
async function api(path, body) {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error?.message || data.error || "Request failed");
  return data;
}
async function guarded(fn) {
  try {
    await fn();
  } catch (error) {
    status(error.message);
  }
}
function bind(id, event, fn) {
  $(id).addEventListener(event, async (e) => {
    e.preventDefault();
    const controls = [...e.currentTarget.querySelectorAll("button")];
    if (e.currentTarget.tagName === "BUTTON") controls.push(e.currentTarget);
    controls.forEach((b) => (b.disabled = true));
    try {
      await fn(e);
    } catch (err) {
      status(err.message);
    } finally {
      controls.forEach((b) => (b.disabled = false));
    }
  });
}
const path = (action) => `/api/teams/${teamId}/${action}`;
const mealPath = (action) => path(`meals/${mealId}/${action}`);
const shareLink = () =>
  `${location.origin}/teams.html?team=${teamId}&meal=${mealId}#join=${session.shareToken}`;
function fill(form, values) {
  for (const [key, value] of Object.entries(values || {})) {
    const el = form.elements.namedItem(key);
    if (el) {
      if (el.type === "checkbox") el.checked = !!value;
      else el.value = value ?? "";
    }
  }
}
function show(id) {
  $(id).hidden = false;
}
async function init() {
  channels = await api("/api/teams/channels");
  if (joinToken && teamId && mealId) {
    show("#participate");
    $("#title").textContent = "Your team meal, your choice.";
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem("moodish:team-preferences"));
    } catch {}
    if (saved) {
      fill($("#response"), saved);
      $("#remember").checked = true;
    }
    await refreshParticipant();
    return;
  }
  const bootstrap = await api("/api/bootstrap");
  if (!bootstrap.user || bootstrap.user.id === "demo:moodish") {
    show("#login");
    if (bootstrap.config?.google)
      $("#teamLogin").href =
        `/api/auth/google/start?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
    $("#demo").hidden = !bootstrap.config?.demo;
    status("Sign in to manage your team.");
    return;
  }
  if (inviteToken && teamId) {
    await api(path("accept"), { token: inviteToken });
    sessionStorage.removeItem(inviteKey);
  }
  if (!teamId) {
    show("#home");
    const data = await api("/api/teams");
    $("#workspaces").innerHTML = data.teams
      .map(
        (t) =>
          `<article><h2>${esc(t.name)}</h2><p>${esc(t.role)}</p><a href="/teams.html?team=${encodeURIComponent(t.id)}">Open workspace</a></article>`,
      )
      .join("");
    status("Choose an office or create your first workspace.");
    return;
  }
  team = await api(`/api/teams/${teamId}`);
  $("#title").textContent = team.name;
  if (mealId) {
    show("#meal");
    $("#back").href = `/teams.html?team=${teamId}`;
    await refreshMeal();
    return;
  }
  show("#workspace");
  fill($("#settings"), team.defaults);
  fill($("#newMeal"), team.defaults);
  $("#newMeal [name=deadline]").value = localDate(
    Date.now() + team.defaults.cutoffMinutes * 60000,
  );
  $("#settings").hidden = team.role !== "owner";
  $("#invite").hidden = team.role !== "owner";
  $("#inviteRole").hidden = team.role !== "owner";
  $("#report").hidden = team.role !== "owner";
  $("#newMeal").hidden = team.role === "purchaser";
  $("#schedule").hidden = team.role === "purchaser";
  $("#scheduleStatus").textContent =
    team.schedule?.error ||
    (team.schedule
      ? `Next run: ${date(team.schedule.nextRun)}. Requires the server scheduler.`
      : "Weekly invitations are off.");
  $("#connections").innerHTML =
    team.role === "owner"
      ? `<button id="slackInstall" ${channels.channels.slack ? "" : "disabled"}>Install Slack</button><button id="slackPair" ${channels.channels.slack ? "" : "disabled"}>Pair Slack channel</button><button id="discordPair" ${channels.channels.discord ? "" : "disabled"}>Connect Discord</button>`
      : "";
  $("#connectionStatus").textContent =
    `Connected: ${team.channels.join(", ") || "none"}. ${Object.entries(
      channels.channels,
    )
      .filter(([, v]) => !v)
      .map(([k]) => k)
      .join(", ")} require provider setup.`;
  if (team.role === "owner") {
    for (const platform of team.channels) {
      const button = document.createElement("button");
      button.textContent = `Disconnect ${platform}`;
      button.onclick = () =>
        guarded(async () => {
          await api(path("disconnect"), { platform });
          location.reload();
        });
      $("#connections").append(button);
    }
    const members = document.createElement("div");
    for (const [userId, role] of Object.entries(team.members || {})) {
      if (role === "owner") continue;
      const row = document.createElement("p");
      row.textContent = `${userId} · ${role} `;
      const remove = document.createElement("button");
      remove.textContent = "Remove access";
      remove.onclick = () =>
        guarded(async () => {
          await api(path("remove-member"), { userId });
          row.remove();
          status("Workspace access revoked.");
        });
      row.append(remove);
      members.append(row);
    }
    $("#connections").append(members);
  }
  if (!channels.schedulerEnabled)
    $("#connectionStatus").append(
      " Internal scheduler is off; configure an external scheduler or enable TEAM_JOBS_ENABLED.",
    );
  if (team.role === "owner") {
    bind("#slackInstall", "click", async () =>
      location.assign((await api(path("slack-install"), {})).url),
    );
    for (const platform of ["slack", "discord"])
      bind(`#${platform}Pair`, "click", async () => {
        const data = await api(path("pair"), { platform });
        $("#connectionStatus").textContent =
          `Run this once in your chosen channel within 10 minutes: ${data.command}`;
        if (data.installUrl) {
          const a = document.createElement("a");
          a.href = data.installUrl;
          a.textContent = " Install Discord bot first";
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          $("#connectionStatus").append(a);
        }
      });
  }
  $("#meals").innerHTML =
    team.sessions
      .map(
        (s) =>
          `<article><h2>${esc(s.vibe)}</h2><p>${s.attending}/${s.capacity} joining · ${esc(s.state.replaceAll("_", " "))}</p><p>Cutoff ${esc(date(s.deadline))}</p><a href="/teams.html?team=${teamId}&meal=${s.id}">Open meal</a></article>`,
      )
      .join("") || "<p>No meals yet. Start with a small team lunch.</p>";
  status("Office settings are saved. Participants do not need an account.");
}
async function refreshMeal() {
  session = await api(path(`meals/${mealId}`));
  $("#mealSummary").innerHTML =
    `<h2>${esc(session.vibe)}</h2><p>${session.attending} joining · ${session.skipped} skipping · ₹${session.budgetPerPerson} each</p><p>${esc(session.state.replaceAll("_", " "))} · Responses close ${esc(date(session.deadline))}</p><p>${esc(session.office)}</p>`;
  $("#responses").textContent =
    session.responses
      .map((p) => `${p.name || "WhatsApp subscriber"}: ${p.attendance}`)
      .join(" · ") || "No responses yet";
  const organizer = ["owner", "organizer"].includes(team.role),
    purchaser = ["owner", "purchaser"].includes(team.role);
  $("#publishSlack").hidden = !organizer || !team.channels.includes("slack");
  $("#publishDiscord").hidden =
    !organizer || !team.channels.includes("discord");
  $("#close").hidden =
    !organizer || !["collecting", "responses_closed"].includes(session.state);
  $("#cancel").hidden =
    !organizer ||
    !["collecting", "responses_closed", "review"].includes(session.state);
  $("#repeat").hidden = !organizer;
  $("#remind").hidden =
    !organizer || !channels.channels.whatsapp || session.state !== "collecting";
  $("#choices").hidden = !organizer || session.state !== "review";
  $("#suggest").hidden = !purchaser || session.state !== "review";
  if (choiceCount === 0) {
    if (session.choices.length) session.choices.forEach(addChoice);
    else addChoice();
  }
  $("#options").innerHTML = session.choices
    .map(
      (c) =>
        `<article><h2>${esc(c.restaurant)}</h2><p>${esc(c.items)}</p><p>₹${c.total} all-in · ${esc(c.coverage)}</p><a target="_blank" rel="noopener noreferrer" href="${esc(c.url)}">Check restaurant</a>${purchaser && session.state === "review" ? `<button data-choice="${c.id}">Review purchasing handoff</button>` : ""}</article>`,
    )
    .join("");
  for (const b of $("#options").querySelectorAll("button"))
    b.onclick = async () => {
      if (
        !confirm(
          "I checked the current all-in price and dietary coverage. Prepare a manual purchasing handoff? This does not order food.",
        )
      )
        return;
      try {
        await api(mealPath("handoff"), {
          choiceId: b.dataset.choice,
          confirmed: true,
        });
        await refreshMeal();
      } catch (e) {
        status(e.message);
      }
    };
  $("#handoff").innerHTML = session.handoff
    ? `<article><h2>Ready for manual checkout</h2><p>${esc(session.handoff.message)}</p><a href="${esc(session.handoff.url)}" target="_blank" rel="noopener noreferrer">Open provider checkout</a></article>`
    : "";
  if (session.order)
    $("#handoff").innerHTML +=
      `<p>Purchase reported: ₹${session.order.total}. ${esc(session.order.verification)}</p>`;
  $("#record").hidden = !purchaser || session.state !== "handoff_ready";
  $("#whatsappShare").href =
    `https://wa.me/?text=${encodeURIComponent(`Join our team meal: ${shareLink()}`)}`;
  status("Share the invitation, then review the meal when responses close.");
}
function addChoice(choice) {
  if (choiceCount >= 3) return;
  const n = choiceCount++;
  const field = document.createElement("fieldset");
  field.innerHTML = `<legend>Option ${n + 1}</legend><label>Restaurant<input name="restaurant${n}" required maxlength="160"></label><label>Items and quantities<textarea name="items${n}" required maxlength="1000"></textarea></label><label>Restaurant / checkout URL<input name="url${n}" type="url" required placeholder="https://"></label><label>All-in total (₹)<input name="total${n}" type="number" min="0.01" step="0.01" required></label><label class="check"><input name="coverage${n}" type="checkbox" required>I checked dietary coverage with participants, price and availability.</label>`;
  $("#choiceFields").append(field);
  if (choice)
    for (const key of ["restaurant", "items", "url", "total"])
      field.querySelector(`[name="${key}${n}"]`).value = choice[key];
}
async function refreshParticipant() {
  session = await api(`/api/team-join/${teamId}/${mealId}`, {
    token: joinToken,
    participantToken,
  });
  $("#joinSummary").innerHTML =
    `<h2>${esc(session.vibe)}</h2><p>₹${session.budgetPerPerson} per person · ${session.attending}/${session.capacity} joining</p><p>Respond by ${esc(date(session.deadline))}</p>`;
  if (session.mine) fill($("#response"), session.mine);
  $("#response").hidden = !session.canRespond;
  $("#forget").hidden =
    !session.mine || !["collecting", "cancelled"].includes(session.state);
  $("#waSubscribe").hidden = true;
  if (!session.mine && channels.channels.whatsapp && channels.whatsappNumber) {
    $("#waSubscribe").hidden = false;
    $("#waSubscribe").href =
      `https://wa.me/${channels.whatsappNumber}?text=${encodeURIComponent(`MEAL ${teamId} ${mealId} ${joinToken} REMIND`)}`;
  }
  status(
    session.mine
      ? `Your response: ${session.mine.attendance}. You can change it until the cutoff.`
      : session.canRespond
        ? "Join or skip with one response."
        : "Responses are closed. Contact the organizer for changes.",
  );
}
bind("#demo", "click", async () => {
  await api("/api/teams/demo", {});
  location.reload();
});
bind("#create", "submit", async (e) => {
  const t = await api("/api/teams", formData(e.currentTarget));
  location.assign(`/teams.html?team=${t.id}`);
});
bind("#settings", "submit", async (e) => {
  await api(path("settings"), formData(e.currentTarget));
  status("Office defaults saved.");
});
bind("#newMeal", "submit", async (e) => {
  const data = formData(e.currentTarget);
  data.deadline = new Date(data.deadline).toISOString();
  if (data.deliveryTime)
    data.deliveryTime = new Date(data.deliveryTime).toISOString();
  const s = await api(path("create-meal"), data);
  location.assign(`/teams.html?team=${teamId}&meal=${s.id}`);
});
bind("#invite", "click", async () => {
  const data = await api(path("invite"), { role: $("#inviteRole").value });
  $("#invitation").textContent =
    `Share this one-use invitation (expires in 24 hours): ${location.origin}/teams.html?team=${teamId}#invite=${data.token}`;
});
bind("#copy", "click", async () => {
  try {
    await navigator.clipboard.writeText(shareLink());
    status("Participation link copied.");
  } catch {
    $("#shareResult").textContent = shareLink();
  }
});
bind("#repeat", "click", async () => {
  const next = Math.max(
    Date.now() + 7 * 86400000,
    session.deadline + 7 * 86400000,
  );
  const s = await api(path("repeat"), {
    sessionId: mealId,
    deadline: new Date(next).toISOString(),
  });
  location.assign(`/teams.html?team=${teamId}&meal=${s.id}`);
});
for (const command of ["close", "cancel", "remind"])
  bind(`#${command}`, "click", async () => {
    const result = await api(mealPath(command), {});
    await refreshMeal();
    if (command === "remind")
      status(`${result.sent} reminders sent; ${result.skipped} skipped.`);
  });
bind("#addChoice", "click", async () => addChoice());
bind("#choices", "submit", async (e) => {
  const data = formData(e.currentTarget);
  await api(mealPath("choices"), {
    choices: Array.from({ length: choiceCount }, (_, n) => ({
      restaurant: data[`restaurant${n}`],
      items: data[`items${n}`],
      url: data[`url${n}`],
      total: Number(data[`total${n}`]),
      coverageConfirmed: data[`coverage${n}`] === "on",
    })),
  });
  await refreshMeal();
});
bind("#record", "submit", async (e) => {
  const data = formData(e.currentTarget);
  await api(mealPath("record-order"), {
    ...data,
    confirmed: data.confirmed === "on",
  });
  await refreshMeal();
});
bind("#response", "submit", async (e) => {
  const data = formData(e.currentTarget);
  data.attendance = e.submitter.value;
  data.muted = data.muted === "on";
  const r = await api(`/api/team-join/${teamId}/${mealId}`, {
    ...data,
    token: joinToken,
    participantToken,
    action: "respond",
  });
  if (r.participantToken) {
    participantToken = r.participantToken;
    localStorage.setItem(participantKey, participantToken);
  }
  if ($("#remember").checked) {
    const { attendance, ...preferences } = data;
    localStorage.setItem(
      "moodish:team-preferences",
      JSON.stringify(preferences),
    );
  } else localStorage.removeItem("moodish:team-preferences");
  await refreshParticipant();
});
bind("#forget", "click", async () => {
  await api(`/api/team-join/${teamId}/${mealId}`, {
    token: joinToken,
    participantToken,
    action: "forget",
  });
  localStorage.removeItem(participantKey);
  participantToken = null;
  await refreshParticipant();
});
bind("#forgetDevice", "click", async () => {
  localStorage.removeItem("moodish:team-preferences");
  $("#remember").checked = false;
  status("Saved preferences removed from this device.");
});
bind("#report", "click", async () => {
  const report = await api(path("report"));
  const keys = [
    "meal",
    "created",
    "state",
    "attendees",
    "estimatedTotal",
    "reportedSpend",
    "verification",
  ];
  const csv = [
    keys.join(","),
    ...report.sessions.map((r) =>
      keys.map((k) => `"${String(r[k]).replaceAll('"', '""')}"`).join(","),
    ),
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "moodish-meals.csv";
  a.click();
  URL.revokeObjectURL(url);
});
init().catch((e) => status(e.message));

bind("#suggest", "click", async () => {
  const result = await api(mealPath("suggest"), {});
  $("#suggestions").textContent =
    result.message +
    " " +
    (result.options
      .map(
        (o) => `${o.restaurant}: ${o.items} (estimated ₹${o.estimatedTotal})`,
      )
      .join(" | ") ||
      "No single-restaurant plan fits all current constraints.");
});

bind("#schedule", "submit", async (e) => {
  await api(path("schedule"), {
    nextRun: new Date(formData(e.currentTarget).nextRun).toISOString(),
  });
  status("Weekly invitations enabled. The server scheduler must be running.");
});
bind("#stopSchedule", "click", async () => {
  await api(path("schedule"), { enabled: false });
  status("Weekly invitations stopped.");
});
for (const platform of ["Slack", "Discord"])
  bind(`#publish${platform}`, "click", async () => {
    await api(mealPath("publish"), { platform: platform.toLowerCase() });
    status("Channel status card published or updated.");
  });
