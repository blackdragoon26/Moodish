const $ = (selector) => document.querySelector(selector);
let authUser = null;
let conversationState = {};
let currentRecommendation = null;
let selectedOptionId = null;
let selectedAddOnIds = new Set();
let currentGroupSession = null;
let currentGroupAccessToken = null;
let selectedGroupOptionId = null;
let mealMemory = [];
let participantSession = null;
let participantSelectedOptionId = null;
let participantSubmitted = false;
let participantVoted = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Something got in the way");
  return body;
}

function formJson(form) {
  return Object.fromEntries(
    [...new FormData(form).entries()].map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])
  );
}

async function boot() {
  const inviteSessionId = new URLSearchParams(window.location.search).get("group");
  const managerAccessToken = new URLSearchParams(window.location.hash.slice(1)).get("access_token");
  if (inviteSessionId && !managerAccessToken) {
    await openParticipantInvite(inviteSessionId);
    return;
  }
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const bootstrap = await api("/api/bootstrap");
      const { config, health } = bootstrap;
      configureLogin(config, health);
      if (bootstrap.user) enterProduct(bootstrap.user, bootstrap.mealMemory || []);
      else $("#loginGate").classList.remove("hidden");
      return;
    } catch (error) {
      lastError = error;
      $("#loginGate").classList.remove("hidden");
      $("#loginNote").textContent =
        attempt < 5
          ? "Moodish is waking up after a service update. Reconnecting automatically…"
          : "Moodish is taking longer to wake up. We’ll keep reconnecting—there is nothing you need to reset.";
      await wait(Math.min(5000, 500 * 2 ** attempt));
    }
  }
  console.warn("Moodish startup is still reconnecting", lastError);
  window.setTimeout(boot, 5000);
}

function configureLogin(config, health) {
  $("#dataModeBadge").textContent = health.swiggyMode === "fixture" ? "Demo data" : "Live Swiggy";
  $("#dataModeBadge").classList.toggle("live", health.swiggyMode !== "fixture");
  $("#demoLogin").classList.toggle("hidden", !config.demo);
  if (!config.google) {
    $("#googleLogin").classList.add("unavailable");
    $("#googleLogin").title = "Add Google OAuth credentials to enable";
    $("#googleLogin").href = "#";
    $("#googleLogin").onclick = (event) => {
      event.preventDefault();
      $("#loginNote").textContent = "Google login is ready in code; add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on Render to switch it on.";
    };
    $("#loginNote").textContent = "Google needs OAuth credentials; Swiggy uses approved MCP access. Demo access is available for review.";
  }
}

function enterProduct(user, history = []) {
  authUser = user;
  mealMemory = history;
  $("#loginGate").classList.add("hidden");
  $("#participantGate").classList.add("hidden");
  $("#product").classList.remove("hidden");
  $("#userName").textContent = user.name;
  $("#userInitial").textContent = user.name.charAt(0).toUpperCase();
  $("#creatorId").value = user.id;
  renderMealMemory();
  renderRailNudge();
  if (mealMemory[0]) {
    const previous = mealMemory[0];
    appendMessage(
      "assistant",
      `I remember your last confirmed plan: ${previous.items?.map((item) => item.name).join(", ") || previous.restaurantName}${
        previous.addOns?.length ? ` with ${previous.addOns.map((item) => item.name).join(", ")} from Instamart` : ""
      }. I’ll use that only as a light preference signal—today’s craving still comes first.`
    );
  }
}

$("#demoLogin").addEventListener("click", async () => {
  await api("/api/auth/demo", { method: "POST", body: "{}" });
  const bootstrap = await api("/api/bootstrap");
  enterProduct(bootstrap.user, bootstrap.mealMemory || []);
});

$("#logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  window.location.reload();
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    showProductView(button.dataset.view);
  });
});

function showProductView(view) {
  document.querySelectorAll(".rail-link").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $("#soloView").classList.toggle("hidden", view !== "solo");
  $("#groupView").classList.toggle("hidden", view !== "group");
  $("#docsView").classList.toggle("hidden", view !== "docs");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("#railPromptList").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-prompt]");
  if (!button) return;
  showProductView("solo");
  $("#chatInput").value = button.dataset.prompt;
  $("#chatComposer").requestSubmit();
});

$("#chatComposer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#chatInput");
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  appendMessage("user", message);
  setChatBusy(true);
  try {
    const result = await api("/api/planner/chat", {
      method: "POST",
      body: JSON.stringify({ message, state: conversationState })
    });
    conversationState = result.state;
    appendMessage("assistant", result.reply);
    renderQuickReplies(result.quickReplies || []);
    if (result.recommendation) renderRecommendation(result.recommendation);
  } catch (error) {
    appendMessage("assistant", `I couldn’t finish that plan: ${error.message}`, true);
  } finally {
    setChatBusy(false);
  }
});

function appendMessage(role, text, isError = false) {
  const article = document.createElement("article");
  article.className = `message ${role}${isError ? " error" : ""}`;
  article.innerHTML =
    role === "assistant"
      ? `<div class="avatar"><img src="/assets/moodish-logo.png" alt="" /></div><div class="bubble"><p>${escapeHtml(text)}</p></div>`
      : `<div class="bubble"><p>${escapeHtml(text)}</p></div>`;
  $("#chatThread").appendChild(article);
  article.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setChatBusy(busy) {
  $("#sendChat").disabled = busy;
  $("#chatInput").disabled = busy;
  if (busy) {
    const thinking = document.createElement("article");
    thinking.id = "thinking";
    thinking.className = "message assistant";
    thinking.innerHTML = `<div class="avatar"><img src="/assets/moodish-logo.png" alt="" /></div><div class="bubble typing"><i></i><i></i><i></i></div>`;
    $("#chatThread").appendChild(thinking);
  } else {
    $("#thinking")?.remove();
    $("#chatInput").focus();
  }
}

function renderQuickReplies(replies) {
  $("#quickReplies").innerHTML = replies.map((reply) => `<button type="button">${escapeHtml(reply)}</button>`).join("");
}

$("#quickReplies").addEventListener("click", (event) => {
  if (event.target.tagName !== "BUTTON") return;
  $("#chatInput").value = event.target.textContent;
  $("#chatComposer").requestSubmit();
});

function renderRecommendation(run) {
  currentRecommendation = run;
  selectedOptionId = run.options[0]?.optionId || null;
  selectedAddOnIds = new Set();
  $("#recommendationDeck").classList.remove("hidden");
  $("#summary").textContent = run.summary;
  $("#traceOutput").textContent = JSON.stringify(run.transparency || {}, null, 2);
  $("#confirmCart").disabled = !selectedOptionId;
  $("#options").innerHTML = run.options.map((option, index) => optionCard(option, index, selectedOptionId)).join("");
  $("#options").querySelectorAll(".option-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectedOptionId = card.dataset.option;
      renderRecommendationSelection();
    });
  });
  renderPairings(run.addOns || []);
  renderCartReview();
  $("#recommendationDeck").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderRecommendationSelection() {
  $("#options").querySelectorAll(".option-card").forEach((card) => {
    const selected = card.dataset.option === selectedOptionId;
    card.classList.toggle("selected", selected);
    card.querySelector(".select-pill").textContent = selected ? "Chosen" : "Choose";
  });
  renderCartReview();
}

function optionCard(option, index, selectedId) {
  const metadata = [
    `₹${option.estimatedTotal}`,
    option.rating ? `${option.rating} ★` : null,
    option.distanceKm ? `${option.distanceKm} km` : null,
    option.matchType
      ? option.matchType === "exact"
        ? "Exact match"
        : option.matchType === "alternative"
          ? "Relevant alternative"
          : "Strong match"
      : null
  ].filter(Boolean);
  return `<article class="option-card ${option.optionId === selectedId ? "selected" : ""}" data-option="${option.optionId}">
    <div class="option-rank">0${index + 1}</div>
    <div class="option-content">
      <div class="option-head"><div><p>${escapeHtml(option.cuisine)}</p><h4>${escapeHtml(option.restaurantName)}</h4></div><span class="select-pill">${option.optionId === selectedId ? "Chosen" : "Choose"}</span></div>
      <p class="dish-line">${option.items.map((item) => `${item.quantity}× ${escapeHtml(item.name)}`).join(" + ")}</p>
      <div class="meta">${metadata.map((item) => `<span>${item}</span>`).join("")}</div>
      ${option.reasons?.length ? `<p class="reason">${escapeHtml(option.reasons.slice(0, 2).join(" · "))}</p>` : ""}
    </div>
  </article>`;
}

function renderPairings(items) {
  $("#pairings").classList.toggle("hidden", !items.length);
  $("#pairings").innerHTML = items.length
    ? `<div class="pairing-head"><div><p class="kicker">Moodish Pairings · optional Instamart cart</p><h4>Make it a complete moment.</h4></div>
         <details class="pairing-why"><summary>Why these?</summary><p>Moodish maps Chinese to chilled drinks, biryani to raita, pizza or burgers to cola, chaap or tandoori food to mint and lemon, spicy food to cooling drinks, and light meals to fruit. A pairing appears only when it is available and fits the remaining budget. It never changes the main-meal ranking and stays in a separate Instamart cart.</p></details>
       </div>
       <div class="pairing-list">${items
         .map(
           (item) => `<button class="pairing-card ${selectedAddOnIds.has(item.productId) ? "selected" : ""}" type="button" data-product-id="${item.productId}" aria-pressed="${selectedAddOnIds.has(item.productId)}">
             <span class="pairing-check">${selectedAddOnIds.has(item.productId) ? "✓" : "+"}</span>
             <strong>${escapeHtml(item.name)}</strong><span class="pairing-price">₹${item.price}</span>
             <small>${escapeHtml(item.pairingReason || "Completes the meal")}</small>
           </button>`
         )
         .join("")}</div>
       <div class="pairing-summary"><span>${selectedAddOnIds.size} selected for a separate Instamart cart</span><strong>₹${items
         .filter((item) => selectedAddOnIds.has(item.productId))
         .reduce((sum, item) => sum + item.price, 0)}</strong></div>`
    : "";
  $("#pairings").querySelectorAll(".pairing-card").forEach((card) => {
    card.addEventListener("click", () => {
      if (selectedAddOnIds.has(card.dataset.productId)) selectedAddOnIds.delete(card.dataset.productId);
      else selectedAddOnIds.add(card.dataset.productId);
      renderPairings(items);
      renderCartReview();
    });
  });
}

function renderCartReview() {
  const option = currentRecommendation?.options?.find((item) => item.optionId === selectedOptionId);
  const selectedPairings = (currentRecommendation?.addOns || []).filter((item) => selectedAddOnIds.has(item.productId));
  const instamartTotal = selectedPairings.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const foodTotal = Number(option?.estimatedTotal || 0);
  $("#confirmCart").disabled = !option;
  $("#cartReviewLabel").textContent = selectedPairings.length ? "Review Food + Instamart carts" : "Review Food cart";
  $("#cartReviewTotal").textContent = `₹${foodTotal + instamartTotal}`;
}

$("#confirmCart").addEventListener("click", async () => {
  if (!currentRecommendation || !selectedOptionId || !window.confirm("Prepare the selected Food and Instamart cart previews? This still will not place an order.")) return;
  const cart = await api("/api/cart/confirm", {
    method: "POST",
    body: JSON.stringify({
      recommendationId: currentRecommendation.recommendationId,
      optionId: selectedOptionId,
      addOnProductIds: [...selectedAddOnIds],
      userIdHash: authUser?.id,
      confirmed: true
    })
  });
  $("#cartOutput").classList.remove("hidden");
  const instamart = cart.instamartCartPreview;
  $("#cartOutput").textContent = [
    `FOOD CART · ${cart.foodCart.restaurant} · ₹${cart.foodCart.total}`,
    ...cart.foodCart.items.map((item) => `${item.quantity}× ${item.name}`),
    "",
    `INSTAMART CART · ₹${instamart.total}`,
    ...(instamart.items.length ? instamart.items.map((item) => `1× ${item.name}`) : ["No add-ons selected"]),
    "",
    "Separate fulfilment · Checkout stays blocked until a later final-confirmation flow."
  ].join("\n");
  if (cart.mealMemoryEntry) {
    mealMemory = [cart.mealMemoryEntry, ...mealMemory.filter((item) => item.recommendationId !== cart.mealMemoryEntry.recommendationId)].slice(0, 6);
    renderMealMemory();
    renderRailNudge();
  }
});

$("#office").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const session = await api("/api/group-sessions", { method: "POST", body: JSON.stringify(formJson(event.currentTarget)) });
    currentGroupSession = session;
    currentGroupAccessToken = session.accessToken;
    selectedGroupOptionId = null;
    $("#groupPreference [name=sessionId]").value = session.sessionId;
    $("#groupPreference").classList.remove("hidden");
    $("#groupControls").classList.remove("hidden");
    $("#copyInvite").disabled = false;
    $("#fillDemoTeam").disabled = false;
    renderGroup(session);
  } catch (error) {
    $("#groupStatus").textContent = `Could not launch enterprise lunch: ${error.message}`;
  }
});

$("#groupPreference").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = formJson(event.currentTarget);
  currentGroupSession = await groupApi(`/api/group-sessions/${payload.sessionId}/preferences`, payload);
  renderGroup(currentGroupSession);
  event.currentTarget.reset();
  $("#groupPreference [name=sessionId]").value = currentGroupSession.sessionId;
});

$("#fillDemoTeam").addEventListener("click", async () => {
  if (!currentGroupSession) return;
  const teammates = [
    { participantId: "anaya", dietMode: "veg", mood: "cheesy and comforting", dietaryRules: "" },
    { participantId: "kabir", dietMode: "non_veg", mood: "spicy chicken", dietaryRules: "high-protein" },
    { participantId: "meera", dietMode: "both", mood: "Chinese with a cold drink", allergies: "peanut" }
  ];
  for (const teammate of teammates) {
    currentGroupSession = await groupApi(`/api/group-sessions/${currentGroupSession.sessionId}/preferences`, teammate);
  }
  renderGroup(currentGroupSession);
});

$("#copyInvite").addEventListener("click", async () => {
  if (!currentGroupSession) return;
  const invite = `${location.origin}/?group=${encodeURIComponent(currentGroupSession.sessionId)}&action=preferences`;
  await navigator.clipboard.writeText(invite);
  $("#copyInvite").textContent = "Private invite copied";
});

$("#rankGroup").addEventListener("click", async () => {
  currentGroupSession = await groupApi(`/api/group-sessions/${currentGroupSession.sessionId}/rank`, {});
  selectedGroupOptionId = currentGroupSession.recommendation?.options?.[0]?.optionId || null;
  renderGroup(currentGroupSession);
});

$("#selectGroup").addEventListener("click", async () => {
  currentGroupSession = await groupApi(`/api/group-sessions/${currentGroupSession.sessionId}/select`, { optionId: selectedGroupOptionId });
  renderGroup(currentGroupSession);
});

$("#voteGroup").addEventListener("click", async () => {
  currentGroupSession = await groupApi(`/api/group-sessions/${currentGroupSession.sessionId}/vote`, {
    participantId: authUser.id,
    optionId: selectedGroupOptionId
  });
  renderGroup(currentGroupSession);
});

$("#confirmGroupCart").addEventListener("click", async () => {
  if (!window.confirm("Confirm the creator-owned food cart? No order will be placed.")) return;
  currentGroupSession = await groupApi(`/api/group-sessions/${currentGroupSession.sessionId}/confirm-cart`, { confirmed: true });
  renderGroup(currentGroupSession);
});

async function groupApi(path, payload) {
  return api(path, {
    method: "POST",
    headers: currentGroupAccessToken ? { authorization: `Bearer ${currentGroupAccessToken}` } : {},
    body: JSON.stringify(payload)
  });
}

function renderGroup(session) {
  const count = session.responseCount || 0;
  const percent = Math.min(100, Math.round((count / session.headcount) * 100));
  $("#groupStatus").textContent = `${count} of ${session.headcount} responses · ${session.state.replaceAll("_", " ")}`;
  $("#groupProgress span").style.width = `${percent}%`;
  $("#rankGroup").disabled = session.state !== "collecting";
  $("#selectGroup").disabled = !["awaiting_manager", "voting"].includes(session.state) || !selectedGroupOptionId;
  $("#voteGroup").disabled = session.state !== "voting" || !selectedGroupOptionId;
  $("#confirmGroupCart").disabled = session.state !== "awaiting_creator_confirmation";
  const options = session.recommendation?.options || session.options || [];
  $("#groupResults").classList.toggle("hidden", !options.length);
  $("#groupOptions").innerHTML = options.map((option, index) => optionCard(option, index, selectedGroupOptionId)).join("");
  $("#groupOptions").querySelectorAll(".option-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectedGroupOptionId = card.dataset.option;
      renderGroup(currentGroupSession);
    });
  });
}

async function openParticipantInvite(sessionId) {
  $("#loginGate").classList.add("hidden");
  $("#product").classList.add("hidden");
  $("#participantGate").classList.remove("hidden");
  try {
    participantSession = await api(`/api/group-sessions/${encodeURIComponent(sessionId)}`);
    renderParticipantSession();
  } catch (error) {
    $("#participantSessionSummary").textContent = "This invite is unavailable.";
    $("#participantStage").innerHTML = `<div class="stage-message error"><strong>We couldn’t open this team meal.</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function renderParticipantSession() {
  const session = participantSession;
  const collected = `${session.responseCount} of ${session.headcount} people have responded`;
  $("#participantSessionSummary").textContent = `${session.vibe} · up to ₹${session.budgetPerPerson} per person · ${collected}`;
  const collecting = session.state === "collecting";
  const voting = session.state === "voting" && (session.options || []).length > 0;
  $("#participantPreferenceForm").classList.toggle("hidden", !collecting || participantSubmitted);
  $("#participantVote").classList.toggle("hidden", !voting);

  if (collecting && participantSubmitted) {
    $("#participantStage").innerHTML = `<div class="stage-message success"><strong>Your preferences are saved.</strong><span>Return to this same link after the manager closes collection. If this lunch uses team voting, the finalists will appear here.</span></div>`;
  } else if (collecting) {
    $("#participantStage").innerHTML = `<div class="stage-message"><strong>Step 1 · Share your boundaries and craving</strong><span>This is not the vote yet. Once collection closes, this same link becomes the voting page when “Team votes” is selected.</span></div>`;
  } else if (voting) {
    $("#participantStage").innerHTML = participantVoted
      ? `<div class="stage-message success"><strong>Your vote is saved.</strong><span>You can still change it while voting remains open by selecting another finalist.</span></div>`
      : `<div class="stage-message voting"><strong>Step 2 · Vote on the finalists</strong><span>Select one plan below. Individual votes are counted without exposing dietary details.</span></div>`;
    participantSelectedOptionId ||= session.options[0]?.optionId || null;
    $("#participantOptions").innerHTML = session.options
      .map((option, index) => optionCard(option, index, participantSelectedOptionId))
      .join("");
    $("#participantOptions").querySelectorAll(".option-card").forEach((card) => {
      card.addEventListener("click", () => {
        participantSelectedOptionId = card.dataset.option;
        renderParticipantSession();
      });
    });
    $("#participantVoteButton").disabled = !participantSelectedOptionId;
  } else {
    const messages = {
      locked: "Collection has closed. Moodish is preparing the finalists.",
      ranking: "Moodish is ranking group-safe meal plans now.",
      awaiting_manager: "Finalists are ready and awaiting the manager’s decision.",
      awaiting_creator_confirmation: "A plan is approved and awaiting the creator’s final cart review.",
      cart_built: "The team meal cart has been prepared.",
      expired: "This team meal invite has expired.",
      cancelled: "This team meal was cancelled."
    };
    $("#participantStage").innerHTML = `<div class="stage-message"><strong>${escapeHtml(messages[session.state] || "This lunch is being updated.")}</strong><span>Use refresh to check the latest status.</span></div>`;
  }
}

$("#participantPreferenceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = formJson(event.currentTarget);
  participantSession = await api(`/api/group-sessions/${participantSession.sessionId}/preferences`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  participantSubmitted = true;
  window.localStorage.setItem(`moodish-participant:${participantSession.sessionId}`, payload.participantId);
  renderParticipantSession();
});

document.querySelectorAll(".segmented").forEach((group) => {
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    group.querySelectorAll("button").forEach((item) => item.classList.toggle("selected", item === button));
    group.parentElement.querySelector(`input[name="${group.dataset.field}"]`).value = button.dataset.value;
  });
});

$("#participantVoteButton").addEventListener("click", async () => {
  const participantId =
    $("#participantVoterId").value.trim() ||
    window.localStorage.getItem(`moodish-participant:${participantSession.sessionId}`);
  if (!participantId) {
    $("#participantVoterId").focus();
    return;
  }
  participantSession = await api(`/api/group-sessions/${participantSession.sessionId}/vote`, {
    method: "POST",
    body: JSON.stringify({ participantId, optionId: participantSelectedOptionId })
  });
  participantVoted = true;
  renderParticipantSession();
});

$("#refreshParticipant").addEventListener("click", async () => {
  if (!participantSession) return;
  participantSession = await api(`/api/group-sessions/${participantSession.sessionId}`);
  renderParticipantSession();
});

function renderMealMemory() {
  $("#memoryCount").textContent = mealMemory.length;
  $("#mealMemoryList").innerHTML = mealMemory.length
    ? mealMemory
        .slice(0, 3)
        .map(
          (meal) => `<article>
            <strong>${escapeHtml(meal.items?.[0]?.name || meal.restaurantName || "Meal plan")}</strong>
            <small>${escapeHtml(meal.restaurantName || meal.cuisine || "")}${meal.foodTotal ? ` · Food ₹${meal.foodTotal}` : ""}</small>
            ${
              meal.addOns?.length
                ? `<small class="memory-addon">+ ${escapeHtml(meal.addOns.map((item) => item.name).join(", "))} · Instamart ₹${meal.instamartTotal || 0}</small>`
                : ""
            }
          </article>`
        )
        .join("")
    : "<small>No confirmed meal plans yet. Your first reviewed cart will appear here.</small>";
}

function renderRailNudge() {
  const hour = new Date().getHours();
  const moment = hour < 11 ? "Breakfast energy" : hour < 16 ? "Lunch window" : hour < 19 ? "Evening bite" : "Dinner mood";
  const defaultPrompt =
    hour < 11
      ? "quick satisfying breakfast, both, under ₹300"
      : hour < 16
        ? "satisfying lunch, both, under ₹400"
        : "comfort food, both, under ₹450";
  $("#railNudge").textContent = mealMemory[0]
    ? `${moment}. Go familiar or make a clean break from your last ${mealMemory[0].cuisine || "meal"}.`
    : `${moment}. Start with a feeling; Moodish will ask only what is missing.`;
  const prompts = [
    { label: "Plan for right now", prompt: defaultPrompt },
    mealMemory[0]
      ? { label: "Something unlike last time", prompt: `something absolutely new, both, under ₹450, different from ${mealMemory[0].cuisine || mealMemory[0].restaurantName}` }
      : { label: "Surprise me", prompt: "something absolutely new, both, under ₹450" }
  ];
  $("#railPromptList").innerHTML = prompts
    .map((item) => `<button type="button" data-prompt="${escapeHtml(item.prompt)}">${escapeHtml(item.label)} <span>→</span></button>`)
    .join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

boot();
