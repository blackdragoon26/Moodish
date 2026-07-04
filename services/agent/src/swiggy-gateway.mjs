import { retrySwiggyCall } from "./telemetry.mjs";

const fixtureRestaurants = [
  {
    id: "r1",
    name: "Millet Monk",
    cuisine: "South Indian",
    rating: 4.6,
    distanceKm: 1.8,
    availabilityStatus: "OPEN",
    priceBand: 280,
    tags: ["veg", "high-protein", "light", "office-friendly"],
    items: [
      { itemId: "i1", name: "Podi Millet Bowl", price: 249, tags: ["vegan", "veg", "high-protein"] },
      { itemId: "i2", name: "Curd Millet Cup", price: 89, tags: ["veg", "cooling"] }
    ]
  },
  {
    id: "r2",
    name: "Thai Box Social",
    cuisine: "Thai",
    rating: 4.4,
    distanceKm: 3.1,
    availabilityStatus: "OPEN",
    priceBand: 360,
    tags: ["non-veg", "spicy", "novel"],
    items: [
      { itemId: "i3", name: "Basil Chicken Rice Box", price: 339, tags: ["non-veg", "high-protein"] },
      { itemId: "i4", name: "Som Tam Salad", price: 179, tags: ["vegan", "veg", "fresh"] }
    ]
  },
  {
    id: "r3",
    name: "Calcutta Cabin",
    cuisine: "Bengali",
    rating: 4.5,
    distanceKm: 2.4,
    availabilityStatus: "OPEN",
    priceBand: 320,
    tags: ["comfort", "fish", "novel"],
    items: [
      { itemId: "i5", name: "Kosha Chicken Lunch Box", price: 319, tags: ["non-veg", "comfort"] },
      { itemId: "i6", name: "Mochar Chop", price: 129, tags: ["veg", "snack"] }
    ]
  },
  {
    id: "r4",
    name: "Protein Paratha Lab",
    cuisine: "North Indian",
    rating: 4.2,
    distanceKm: 1.2,
    availabilityStatus: "OPEN",
    priceBand: 220,
    tags: ["veg", "high-protein", "familiar"],
    items: [
      { itemId: "i7", name: "Soya Keema Paratha Combo", price: 219, tags: ["veg", "high-protein"] },
      { itemId: "i8", name: "Masala Chaas", price: 69, tags: ["veg", "beverage"] }
    ]
  },
  {
    id: "r5",
    name: "Nizam Rain Biryani",
    cuisine: "Biryani",
    rating: 4.5,
    distanceKm: 2.1,
    availabilityStatus: "OPEN",
    priceBand: 340,
    tags: ["spicy", "comfort", "biryani", "non-veg", "rainy", "rice"],
    items: [
      { itemId: "i9", name: "Hyderabadi Chicken Dum Biryani", price: 329, tags: ["non-veg", "spicy", "biryani", "comfort"] },
      { itemId: "i10", name: "Mirchi Salan", price: 79, tags: ["veg", "spicy", "side"] }
    ]
  },
  {
    id: "r6",
    name: "Green Fork Deli",
    cuisine: "Healthy",
    rating: 4.3,
    distanceKm: 1.6,
    availabilityStatus: "OPEN",
    priceBand: 260,
    tags: ["vegan", "veg", "light", "fresh", "salad", "healthy"],
    items: [
      { itemId: "i11", name: "Avocado Chickpea Crunch Salad", price: 259, tags: ["vegan", "veg", "fresh", "salad", "high-protein"] },
      { itemId: "i12", name: "Cold-Pressed Kokum Spritz", price: 119, tags: ["vegan", "beverage", "cooling"] }
    ]
  },
  {
    id: "r7",
    name: "Cocoa Afterhours",
    cuisine: "Dessert",
    rating: 4.7,
    distanceKm: 2.8,
    availabilityStatus: "OPEN",
    priceBand: 240,
    tags: ["dessert", "sweet", "chocolate", "comfort", "novel"],
    items: [
      { itemId: "i13", name: "Dark Chocolate Fudge Jar", price: 229, tags: ["dessert", "sweet", "chocolate"] },
      { itemId: "i14", name: "Filter Coffee Tiramisu Cup", price: 249, tags: ["dessert", "coffee", "novel"] }
    ]
  },
  {
    id: "r8",
    name: "Slice Room",
    cuisine: "Pizza",
    rating: 4.2,
    distanceKm: 2.9,
    availabilityStatus: "OPEN",
    priceBand: 290,
    tags: ["pizza", "office-friendly", "comfort", "sharing", "veg"],
    items: [
      { itemId: "i15", name: "Margherita Personal Pizza", price: 249, tags: ["veg", "pizza", "comfort"] },
      { itemId: "i16", name: "Peri Peri Paneer Slice Box", price: 289, tags: ["veg", "spicy", "pizza", "sharing"] }
    ]
  },
  {
    id: "r9",
    name: "Post Gym Grill",
    cuisine: "Continental",
    rating: 4.4,
    distanceKm: 1.9,
    availabilityStatus: "OPEN",
    priceBand: 380,
    tags: ["high-protein", "chicken", "healthy", "non-veg", "workout"],
    items: [
      { itemId: "i17", name: "Grilled Chicken Quinoa Box", price: 369, tags: ["non-veg", "chicken", "high-protein", "healthy"] },
      { itemId: "i18", name: "Egg White Protein Bowl", price: 299, tags: ["egg", "high-protein", "healthy"] }
    ]
  },
  {
    id: "r10",
    name: "Budget Punjabi Rasoi",
    cuisine: "North Indian",
    rating: 4.1,
    distanceKm: 1.4,
    availabilityStatus: "OPEN",
    priceBand: 190,
    tags: ["budget", "cheap", "comfort", "north-indian", "veg"],
    items: [
      { itemId: "i19", name: "Rajma Rice Value Bowl", price: 169, tags: ["veg", "comfort", "budget"] },
      { itemId: "i20", name: "Paneer Roti Mini Thali", price: 199, tags: ["veg", "north-indian", "comfort"] }
    ]
  }
];

const fixtureProducts = [
  { productId: "p1", name: "Tender Coconut Water", price: 79, tags: ["beverage", "cooling"] },
  { productId: "p2", name: "Seasonal Fruit Box", price: 149, tags: ["fruit", "office-friendly"] },
  { productId: "p3", name: "Roasted Makhana", price: 119, tags: ["snack", "high-protein"] },
  { productId: "p4", name: "Paper Plates Pack", price: 99, tags: ["office-supply"] }
];

export function createSwiggyGateway() {
  const mode = process.env.SWIGGY_MODE || "fixture";
  if (mode === "live") return liveGateway();
  return fixtureGateway();
}

function fixtureGateway() {
  return {
    mode: "fixture",
    async getAddresses() {
      return [{ id: "addr-home", label: "Home", display: "Fixture address, Delhi NCR" }];
    },
    async searchRestaurants({ query = "", addressId }) {
      void addressId;
      const tokens = expandIntentTokens(query);
      return fixtureRestaurants.filter((restaurant) => {
        if (!tokens.length) return true;
        const haystack = restaurantSearchText(restaurant);
        return tokens.some((token) => haystack.includes(token));
      });
    },
    async getRestaurantMenu({ restaurantId }) {
      const restaurant = fixtureRestaurants.find((item) => item.id === restaurantId);
      if (!restaurant) {
        const error = new Error("Restaurant not found");
        error.status = 404;
        throw error;
      }
      return { restaurantId, items: restaurant.items, restaurant };
    },
    async searchProducts({ query = "" }) {
      const q = query.toLowerCase();
      return fixtureProducts.filter((product) => !q || product.tags.some((tag) => tag.includes(q)) || product.name.toLowerCase().includes(q));
    },
    async buildFoodCart({ restaurantId, items }) {
      const menu = await this.getRestaurantMenu({ restaurantId });
      const cartItems = items.map((wanted) => {
        const item = menu.items.find((candidate) => candidate.itemId === wanted.itemId);
        return { ...item, quantity: wanted.quantity || 1 };
      });
      return {
        cartId: `cart_${restaurantId}`,
        restaurant: menu.restaurant.name,
        items: cartItems,
        total: cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
        paymentMethod: "COD",
        mode: "fixture"
      };
    }
  };
}

function restaurantSearchText(restaurant) {
  return [
    restaurant.name,
    restaurant.cuisine,
    ...restaurant.tags,
    ...restaurant.items.flatMap((item) => [item.name, ...item.tags])
  ]
    .join(" ")
    .toLowerCase();
}

export function expandIntentTokens(value = "") {
  const source = String(value).toLowerCase();
  const baseTokens = source.match(/[a-z0-9]+/g) || [];
  const phraseTokens = [];
  if (source.includes("north indian")) phraseTokens.push("north-indian");
  if (source.includes("post workout")) phraseTokens.push("workout", "high-protein");
  if (source.includes("high protein")) phraseTokens.push("high-protein");
  const expansions = {
    biryani: ["biryani", "rice", "spicy", "comfort"],
    rainy: ["rainy", "comfort", "spicy"],
    rain: ["rainy", "comfort"],
    spicy: ["spicy"],
    vegan: ["vegan", "veg", "light", "fresh"],
    healthy: ["healthy", "light", "fresh"],
    salad: ["salad", "fresh", "light"],
    sweet: ["sweet", "dessert"],
    dessert: ["dessert", "sweet"],
    chocolate: ["chocolate", "dessert"],
    cheap: ["cheap", "budget"],
    budget: ["budget", "cheap"],
    pizza: ["pizza", "sharing", "office-friendly"],
    party: ["sharing", "office-friendly", "pizza"],
    workout: ["workout", "high-protein", "healthy"],
    protein: ["high-protein", "healthy"],
    chicken: ["chicken", "non-veg", "high-protein"],
    comfort: ["comfort"],
    light: ["light", "fresh"],
    office: ["office-friendly", "sharing"]
  };
  const expanded = baseTokens.flatMap((token) => expansions[token] || [token]);
  return [...new Set([...baseTokens, ...phraseTokens, ...expanded].filter((token) => token.length > 1))];
}

function liveGateway() {
  const token = process.env.SWIGGY_ACCESS_TOKEN;
  const base = "https://mcp.swiggy.com";
  async function callTool(server, name, args = {}) {
    if (!token) {
      const error = new Error("SWIGGY_ACCESS_TOKEN is required for live mode");
      error.status = 401;
      throw error;
    }
    return retrySwiggyCall(async () => {
      const response = await fetch(`${base}/${server}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `${Date.now()}`,
          method: "tools/call",
          params: { name, arguments: args }
        })
      });
      if (!response.ok) {
        const error = new Error(`Swiggy ${server}.${name} failed with ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const body = await response.json();
      if (body.error) throw new Error(body.error.message || "Swiggy MCP error");
      return body.result?.data ?? body.result ?? body;
    });
  }
  return {
    mode: "live",
    getAddresses: () => callTool("food", "get_addresses"),
    searchRestaurants: (args) => callTool("food", "search_restaurants", args),
    getRestaurantMenu: (args) => callTool("food", "get_restaurant_menu", args),
    searchProducts: (args) => callTool("im", "search_products", args),
    buildFoodCart: (args) => callTool("food", "update_food_cart", args)
  };
}
