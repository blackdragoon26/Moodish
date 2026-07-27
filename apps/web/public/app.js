const $ = (selector) => document.querySelector(selector);
let authUser = null;
let conversationState = {};
let currentRecommendation = null;
let selectedOptionId = null;
let selectedAddOnIds = new Set();
let currentGroupSession = null;
let currentGroupAccessToken = null;
let selectedGroupOptionId = null;

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
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const bootstrap = await api("/api/bootstrap");
      const { config, health } = bootstrap;
      configureLogin(config, health);
      if (bootstrap.user) enterProduct(bootstrap.user);
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
  $("#healthText").textContent = health.swiggyMode === "fixture" ? "Demo availability" : "Live availability";
  $("#demoBadge").classList.toggle("hidden", health.swiggyMode !== "fixture");
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

function enterProduct(user) {
  authUser = user;
  $("#loginGate").classList.add("hidden");
  $("#product").classList.remove("hidden");
  $("#userName").textContent = user.name;
  $("#userInitial").textContent = user.name.charAt(0).toUpperCase();
  $("#creatorId").value = user.id;
}

$("#demoLogin").addEventListener("click", async () => {
  const { user } = await api("/api/auth/demo", { method: "POST", body: "{}" });
  enterProduct(user);
});

$("#logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  window.location.reload();
});

document.querySelectorAll(".rail-link").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".rail-link").forEach((item) => item.classList.toggle("active", item === button));
    $("#soloView").classList.toggle("hidden", button.dataset.view !== "solo");
    $("#groupView").classList.toggle("hidden", button.dataset.view !== "group");
  });
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
      ? `<div class="avatar">M</div><div class="bubble"><p>${escapeHtml(text)}</p></div>`
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
    thinking.innerHTML = `<div class="avatar">M</div><div class="bubble typing"><i></i><i></i><i></i></div>`;
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
  $("#recommendationDeck").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderRecommendationSelection() {
  $("#options").querySelectorAll(".option-card").forEach((card) => {
    const selected = card.dataset.option === selectedOptionId;
    card.classList.toggle("selected", selected);
    card.querySelector(".select-pill").textContent = selected ? "Chosen" : "Choose";
  });
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
    ? `<div><p class="kicker">Moodish Pairings · optional Instamart cart</p><h4>Make it a complete moment.</h4></div>
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
    });
  });
}

$("#confirmCart").addEventListener("click", async () => {
  if (!currentRecommendation || !selectedOptionId || !window.confirm("Prepare the selected Food and Instamart cart previews? This still will not place an order.")) return;
  const cart = await api("/api/cart/confirm", {
    method: "POST",
    body: JSON.stringify({
      recommendationId: currentRecommendation.recommendationId,
      optionId: selectedOptionId,
      addOnProductIds: [...selectedAddOnIds],
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
  const invite = `${location.origin}/?group=${encodeURIComponent(currentGroupSession.sessionId)}`;
  await navigator.clipboard.writeText(invite);
  $("#copyInvite").textContent = "Invite copied";
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

boot();
