import { createServer } from "../services/agent/src/server.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

try {
  const solo = await post(port, "/api/recommendations/personal", {
    budget: 350,
    mood: "surprise me with something high protein",
    dietaryRules: "high-protein",
    novelty: 4
  });
  const office = await post(port, "/api/recommendations/office", {
    headcount: 6,
    budgetPerPerson: 250,
    dietaryRules: "veg, high-protein",
    cuisineAvoidList: "North Indian"
  });
  const cart = await post(port, "/api/cart/confirm", {
    recommendationId: solo.recommendationId,
    optionId: solo.options[0].optionId,
    confirmed: true
  });

  console.log(JSON.stringify({
    ok: true,
    soloTopPick: solo.options[0].restaurantName,
    officeTopPick: office.options[0].restaurantName,
    cartTotal: cart.total,
    checkoutBlocked: cart.checkoutBlocked
  }, null, 2));
} finally {
  server.close();
}

async function post(port, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `${path} failed`);
  return data;
}
