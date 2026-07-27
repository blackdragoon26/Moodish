const agentBase = window.location.origin;
let currentRecommendation = null;
let currentGroupSession = null;
let currentGroupAccessToken = null;
let selectedOptionId = null;
let activeMode = "solo";

const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(`${agentBase}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "Request failed");
    error.details = body.details;
    throw error;
  }
  return body;
}

function formJson(form) {
  const data = new FormData(form);
  return Object.fromEntries([...data.entries()].map(([key, value]) => [key, value.trim?.() ?? value]));
}

function recommendationPayload(form) {
  const payload = formJson(form);
  const aiApiKey = $("#clientAiKey")?.value?.trim();
  const aiModel = $("#clientAiModel")?.value?.trim();
  if (aiApiKey) payload.aiApiKey = aiApiKey;
  if (aiApiKey && aiModel) payload.aiModel = aiModel;
  return payload;
}

function renderRecommendation(run) {
  currentRecommendation = run;
  const optionStillExists = run.options.some((option) => option.optionId === selectedOptionId);
  selectedOptionId = optionStillExists ? selectedOptionId : run.options[0]?.optionId || null;
  $("#summary").textContent = run.summary;
  $("#traceOutput").textContent = JSON.stringify(run.transparency || {}, null, 2);
  $("#confirmCart").disabled = !selectedOptionId;
  $("#options").innerHTML = run.options
    .map(
      (option, index) => `
      <article
        class="option-card ${option.optionId === selectedOptionId ? "selected" : ""}"
        data-option="${option.optionId}"
        role="radio"
        aria-checked="${option.optionId === selectedOptionId}"
        tabindex="0"
      >
        <div class="option-head">
          <h4>${index + 1}. ${option.restaurantName}</h4>
          <span class="select-pill">${option.optionId === selectedOptionId ? "Selected" : "Select"}</span>
        </div>
        <div class="meta">
          <span>${option.cuisine}</span>
          <span>₹${option.estimatedTotal}</span>
          <span>${option.rating} ★</span>
          <span>${option.distanceKm} km</span>
        </div>
        <p>${option.items.map((item) => `${item.quantity}x ${item.name}`).join(", ")}</p>
        <p class="match-note">${option.matchType === "exact" ? "Exact craving match" : option.matchType === "alternative" ? "Similar alternative" : "Broad recommendation"} · ${option.dataSource === "fixture" ? "Demo data" : "Live Swiggy data"}</p>
        <p>${option.reasons.slice(0, 3).join(" · ")}</p>
        ${
          option.addOns
            ? `<p><strong>Instamart add-ons:</strong> ${option.addOns.map((item) => item.name).join(", ")}</p>`
            : ""
        }
      </article>`
    )
    .join("");
  if (run.addOns?.length) {
    $("#options").insertAdjacentHTML(
      "beforeend",
      `<article class="add-on-card"><h4>Optional Instamart add-ons</h4><p>${run.addOns
        .map((item) => `${item.name} · ₹${item.price}`)
        .join("</p><p>")}</p><small>Separate Instamart cart and fulfilment.</small></article>`
    );
  }
  document.querySelectorAll(".option-card").forEach((card) => {
    const selectOption = () => {
      selectedOptionId = card.dataset.option;
      renderRecommendation(currentRecommendation);
    };
    card.addEventListener("click", selectOption);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectOption();
      }
    });
  });
  document.querySelector(".results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function setBusy(isBusy, message = "Working on it...") {
  const activeSubmit = document.querySelector(`#${activeMode} button[type="submit"]`);
  document.querySelectorAll("button").forEach((button) => {
    if (button.id !== "confirmCart") button.disabled = isBusy;
  });
  if (activeSubmit) activeSubmit.textContent = isBusy ? message : activeMode === "solo" ? "Find my mood meal" : "Create group session";
}

function showError(error, context = "Something went wrong") {
  $("#summary").classList.add("error");
  $("#summary").textContent = `${context}: ${error.message}`;
  if (error.details) {
    $("#traceOutput").textContent = JSON.stringify(
      {
        error: error.message,
        details: error.details
      },
      null,
      2
    );
  }
}

function clearError() {
  $("#summary").classList.remove("error");
}

async function refreshHealth() {
  try {
    const health = await api("/health");
    $("#healthText").textContent = `${health.swiggyMode || health.mode} · ${health.aiProvider || "ai unknown"}`;
    $("#demoBanner").classList.toggle("hidden", health.swiggyMode !== "fixture");
    const audit = await api("/api/audit");
    $("#auditOutput").textContent = JSON.stringify(audit, null, 2);
  } catch (error) {
    $("#healthText").textContent = "API offline";
  }
}

function setMode(mode) {
  activeMode = mode;
  document.querySelectorAll(".mode-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.mode === mode);
  });
  $("#solo").classList.toggle("hidden", mode !== "solo");
  $("#office").classList.toggle("hidden", mode !== "office");
  $("#groupPreference").classList.toggle("hidden", mode !== "office" || !currentGroupSession);
  $("#groupControls").classList.toggle("hidden", mode !== "office" || !currentGroupSession);
  if (mode === "solo" && currentRecommendation) {
    renderRecommendation(currentRecommendation);
  } else if (mode === "office" && currentGroupSession) {
    selectedOptionId = currentGroupSession.selectedOptionId || currentGroupSession.recommendation?.options?.[0]?.optionId || null;
    renderGroupSession(currentGroupSession);
  } else {
    selectedOptionId = null;
    $("#options").innerHTML = "";
    $("#confirmCart").disabled = true;
    $("#summary").textContent =
      mode === "solo" ? "Tell Moodish your mood and budget." : "Create a group session to collect private preferences.";
  }
  clearError();
}

async function refreshMemory() {
  try {
    const memory = await api("/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "memory",
        method: "tools/call",
        params: { name: "get_taste_memory", arguments: {} }
      })
    });
    $("#memoryOutput").textContent = JSON.stringify(memory.result?.data || memory, null, 2);
  } catch (error) {
    $("#memoryOutput").textContent = `Taste memory unavailable: ${error.message}`;
  }
}

$("#solo").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  setBusy(true, "Finding...");
  try {
    const run = await api("/api/recommendations/personal", { method: "POST", body: JSON.stringify(recommendationPayload(event.currentTarget)) });
    renderRecommendation(run);
    refreshHealth();
  } catch (error) {
    showError(error, "Could not plan a solo meal");
  } finally {
    setBusy(false);
  }
});

$("#office").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  setBusy(true, "Planning...");
  try {
    const session = await api("/api/group-sessions", {
      method: "POST",
      body: JSON.stringify(recommendationPayload(event.currentTarget))
    });
    currentGroupSession = session;
    currentGroupAccessToken = session.accessToken;
    sessionStorage.setItem(`moodish-group:${session.sessionId}`, currentGroupAccessToken);
    $("#groupPreference [name=sessionId]").value = session.sessionId;
    $("#groupPreference").classList.remove("hidden");
    $("#groupControls").classList.remove("hidden");
    renderGroupSession(session);
    refreshHealth();
  } catch (error) {
    showError(error, "Could not plan office lunch");
  } finally {
    setBusy(false);
  }
});

$("#groupPreference").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = formJson(event.currentTarget);
  const session = await api(`/api/group-sessions/${payload.sessionId}/preferences`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  currentGroupSession = { ...currentGroupSession, ...session };
  renderGroupSession(currentGroupSession);
});

$("#rankGroup").addEventListener("click", async () => {
  if (!currentGroupSession) return;
  const session = await api(`/api/group-sessions/${currentGroupSession.sessionId}/rank`, {
    method: "POST",
    headers: { authorization: `Bearer ${currentGroupAccessToken}` },
    body: JSON.stringify({ actorId: currentGroupSession.creatorId })
  });
  currentGroupSession = session;
  selectedOptionId = session.recommendation?.options?.[0]?.optionId || null;
  renderGroupSession(session);
});

$("#voteGroup").addEventListener("click", async () => {
  if (!currentGroupSession || !selectedOptionId) return;
  const participantId = $("#groupPreference [name=participantId]").value.trim();
  if (!participantId) return;
  const session = await api(`/api/group-sessions/${currentGroupSession.sessionId}/vote`, {
    method: "POST",
    body: JSON.stringify({ participantId, optionId: selectedOptionId })
  });
  currentGroupSession = { ...currentGroupSession, ...session };
  renderGroupSession(currentGroupSession);
});

$("#selectGroup").addEventListener("click", async () => {
  if (!currentGroupSession || !selectedOptionId) return;
  const session = await api(`/api/group-sessions/${currentGroupSession.sessionId}/select`, {
    method: "POST",
    headers: { authorization: `Bearer ${currentGroupAccessToken}` },
    body: JSON.stringify({ actorId: currentGroupSession.creatorId, optionId: selectedOptionId })
  });
  currentGroupSession = session;
  renderGroupSession(session);
});

$("#confirmCart").addEventListener("click", async () => {
  if (activeMode === "office" && currentGroupSession) {
    $("#confirmCart").disabled = true;
    try {
      const session = await api(`/api/group-sessions/${currentGroupSession.sessionId}/confirm-cart`, {
        method: "POST",
        headers: { authorization: `Bearer ${currentGroupAccessToken}` },
        body: JSON.stringify({ actorId: currentGroupSession.creatorId, confirmed: true })
      });
      currentGroupSession = session;
      $("#cartOutput").textContent = JSON.stringify(session.cart, null, 2);
      renderGroupSession(session);
    } catch (error) {
      $("#cartOutput").textContent = `Could not build group cart: ${error.message}`;
    }
    return;
  }
  if (!currentRecommendation || !selectedOptionId) return;
  $("#confirmCart").disabled = true;
  $("#confirmCart").textContent = "Building...";
  try {
    const cart = await api("/api/cart/confirm", {
      method: "POST",
      body: JSON.stringify({
        recommendationId: currentRecommendation.recommendationId,
        optionId: selectedOptionId,
        confirmed: true
      })
    });
    $("#cartOutput").textContent = JSON.stringify(cart, null, 2);
    refreshHealth();
  } catch (error) {
    $("#cartOutput").textContent = `Could not build cart: ${error.message}`;
  } finally {
    $("#confirmCart").textContent = "Build cart";
    $("#confirmCart").disabled = !selectedOptionId;
  }
});

function renderGroupSession(session) {
  const options = session.recommendation?.options || session.options || [];
  $("#summary").textContent = `Group session ${session.state} · ${session.responseCount}/${session.headcount} responses · ${session.approvalMode.replaceAll("_", " ")}`;
  $("#traceOutput").textContent = JSON.stringify(
    { sessionId: session.sessionId, state: session.state, aggregate: session.aggregate, voteCounts: session.voteCounts },
    null,
    2
  );
  $("#options").innerHTML = options
    .map(
      (option, index) => `<article class="option-card ${option.optionId === selectedOptionId ? "selected" : ""}" data-option="${option.optionId}" role="radio" tabindex="0">
        <div class="option-head"><h4>${index + 1}. ${option.restaurantName}</h4><span class="select-pill">${option.optionId === selectedOptionId ? "Selected" : "Select"}</span></div>
        <p>${option.items.map((item) => `${item.quantity}x ${item.name}`).join(", ")}</p>
        <p>₹${option.estimatedTotal} · ${option.cuisine}</p>
      </article>`
    )
    .join("");
  document.querySelectorAll(".option-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectedOptionId = card.dataset.option;
      renderGroupSession(currentGroupSession);
    });
  });
  $("#rankGroup").disabled = session.state !== "collecting";
  $("#voteGroup").disabled = session.state !== "voting" || !selectedOptionId;
  $("#selectGroup").disabled = !["voting", "awaiting_manager"].includes(session.state) || !selectedOptionId;
  $("#confirmCart").disabled = session.state !== "awaiting_creator_confirmation";
}

$("#exportMemory").addEventListener("click", refreshMemory);
$("#clearMemory").addEventListener("click", async () => {
  try {
    await api("/api/privacy/delete-taste-memory", { method: "POST", body: JSON.stringify({}) });
    await refreshMemory();
  } catch (error) {
    $("#memoryOutput").textContent = `Could not delete memory: ${error.message}`;
  }
});

document.querySelectorAll(".mode-tab").forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
});

setMode(activeMode);
refreshHealth();
refreshMemory();
restoreGroupFromUrl();

async function restoreGroupFromUrl() {
  const url = new URL(window.location.href);
  const sessionId = url.searchParams.get("group");
  const token =
    new URLSearchParams(url.hash.replace(/^#/, "")).get("access_token") ||
    (sessionId ? sessionStorage.getItem(`moodish-group:${sessionId}`) : null);
  if (!sessionId || !token) return;
  try {
    currentGroupAccessToken = token;
    sessionStorage.setItem(`moodish-group:${sessionId}`, token);
    currentGroupSession = await api(`/api/group-sessions/${encodeURIComponent(sessionId)}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    activeMode = "office";
    setMode("office");
    history.replaceState({}, "", `/?group=${encodeURIComponent(sessionId)}`);
  } catch (error) {
    showError(error, "Could not open the manager dashboard");
  }
}
