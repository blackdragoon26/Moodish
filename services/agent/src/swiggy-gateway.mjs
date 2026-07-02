import { retrySwiggyCall } from "./telemetry.mjs";

const demoRestaurants = [
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
      { itemId: "i1", name: "Podi Millet Bowl", price: 249, tags: ["veg", "high-protein"] },
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
      { itemId: "i4", name: "Som Tam Salad", price: 179, tags: ["veg", "fresh"] }
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
  }
];

const demoProducts = [
  { productId: "p1", name: "Tender Coconut Water", price: 79, tags: ["beverage", "cooling"] },
  { productId: "p2", name: "Seasonal Fruit Box", price: 149, tags: ["fruit", "office-friendly"] },
  { productId: "p3", name: "Roasted Makhana", price: 119, tags: ["snack", "high-protein"] },
  { productId: "p4", name: "Paper Plates Pack", price: 99, tags: ["office-supply"] }
];

export function createSwiggyGateway() {
  const mode = process.env.SWIGGY_MODE || "demo";
  if (mode === "live") return liveGateway();
  return demoGateway();
}

function demoGateway() {
  return {
    mode: "demo",
    async getAddresses() {
      return [{ id: "addr-home", label: "Home", display: "Demo Home, Delhi NCR" }];
    },
    async searchRestaurants({ query = "", addressId }) {
      void addressId;
      const q = query.toLowerCase();
      return demoRestaurants.filter((restaurant) => {
        if (!q) return true;
        return (
          restaurant.name.toLowerCase().includes(q) ||
          restaurant.cuisine.toLowerCase().includes(q) ||
          restaurant.tags.some((tag) => tag.includes(q))
        );
      });
    },
    async getRestaurantMenu({ restaurantId }) {
      const restaurant = demoRestaurants.find((item) => item.id === restaurantId);
      if (!restaurant) {
        const error = new Error("Restaurant not found");
        error.status = 404;
        throw error;
      }
      return { restaurantId, items: restaurant.items, restaurant };
    },
    async searchProducts({ query = "" }) {
      const q = query.toLowerCase();
      return demoProducts.filter((product) => !q || product.tags.some((tag) => tag.includes(q)) || product.name.toLowerCase().includes(q));
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
        mode: "demo"
      };
    }
  };
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
