const agentBase = "http://127.0.0.1:8786";
let currentRecommendation = null;
let selectedOptionId = null;
let activeMode = "solo";

const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(`${agentBase}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

function formJson(form) {
  const data = new FormData(form);
  return Object.fromEntries([...data.entries()].map(([key, value]) => [key, value.trim?.() ?? value]));
}

function renderRecommendation(run) {
  currentRecommendation = run;
  selectedOptionId = run.options[0]?.optionId || null;
  $("#summary").textContent = run.summary;
  $("#confirmCart").disabled = !selectedOptionId;
  $("#options").innerHTML = run.options
    .map(
      (option, index) => `
      <article class="option-card ${option.optionId === selectedOptionId ? "selected" : ""}" data-option="${option.optionId}">
        <h4>${index + 1}. ${option.restaurantName}</h4>
        <div class="meta">
          <span>${option.cuisine}</span>
          <span>₹${option.estimatedTotal}</span>
          <span>${option.rating} ★</span>
          <span>${option.distanceKm} km</span>
        </div>
        <p>${option.items.map((item) => `${item.quantity}x ${item.name}`).join(", ")}</p>
        <p>${option.reasons.slice(0, 3).join(" · ")}</p>
        ${
          option.addOns
            ? `<p><strong>Instamart add-ons:</strong> ${option.addOns.map((item) => item.name).join(", ")}</p>`
            : ""
        }
      </article>`
    )
    .join("");
  document.querySelectorAll(".option-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectedOptionId = card.dataset.option;
      renderRecommendation(currentRecommendation);
    });
  });
}

async function refreshHealth() {
  try {
    const health = await api("/health");
    $("#healthText").textContent = `${health.mode} mode`;
    const audit = await api("/api/audit");
    $("#auditOutput").textContent = JSON.stringify(audit, null, 2);
  } catch (error) {
    $("#healthText").textContent = `Agent unavailable: ${error.message}`;
  }
}

function setMode(mode) {
  activeMode = mode;
  document.querySelectorAll(".mode-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.mode === mode);
  });
  $("#solo").classList.toggle("hidden", mode !== "solo");
  $("#office").classList.toggle("hidden", mode !== "office");
  $("#summary").textContent =
    mode === "solo" ? "Tell Moodish your mood and budget." : "Set the team constraints and get a shared lunch shortlist.";
}

async function refreshMemory() {
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
}

$("#solo").addEventListener("submit", async (event) => {
  event.preventDefault();
  const run = await api("/api/recommendations/personal", { method: "POST", body: JSON.stringify(formJson(event.currentTarget)) });
  renderRecommendation(run);
  refreshHealth();
});

$("#office").addEventListener("submit", async (event) => {
  event.preventDefault();
  const run = await api("/api/recommendations/office", { method: "POST", body: JSON.stringify(formJson(event.currentTarget)) });
  renderRecommendation(run);
  refreshHealth();
});

$("#confirmCart").addEventListener("click", async () => {
  if (!currentRecommendation || !selectedOptionId) return;
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
});

$("#exportMemory").addEventListener("click", refreshMemory);
$("#clearMemory").addEventListener("click", async () => {
  await api("/api/privacy/delete-taste-memory", { method: "POST", body: JSON.stringify({}) });
  await refreshMemory();
});

document.querySelectorAll(".mode-tab").forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
});

setMode(activeMode);
refreshHealth();
refreshMemory();
