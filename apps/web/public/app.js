const agentBase = window.location.origin;
let currentRecommendation = null;
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
  if (activeSubmit) activeSubmit.textContent = isBusy ? message : activeMode === "solo" ? "Find my mood meal" : "Plan team lunch";
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
  $("#summary").textContent =
    mode === "solo" ? "Tell Moodish your mood and budget." : "Set the team constraints and get a shared lunch shortlist.";
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
    const run = await api("/api/recommendations/office", { method: "POST", body: JSON.stringify(recommendationPayload(event.currentTarget)) });
    renderRecommendation(run);
    refreshHealth();
  } catch (error) {
    showError(error, "Could not plan office lunch");
  } finally {
    setBusy(false);
  }
});

$("#confirmCart").addEventListener("click", async () => {
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
