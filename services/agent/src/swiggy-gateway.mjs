import { createLiveCaller, upstreamError } from "./swiggy-client.mjs";

const fixtureRestaurants = [
  {
    id: "r0",
    name: "Delhi Chaap Junction",
    cuisine: "North Indian",
    rating: 4.5,
    distanceKm: 1.3,
    availabilityStatus: "OPEN",
    priceBand: 260,
    tags: ["chaap", "tandoori", "smoky", "north-indian", "veg", "non-veg"],
    items: [
      { itemId: "i0a", name: "Malai Soya Chaap", price: 249, tags: ["veg", "chaap", "soya", "chewy", "creamy", "tandoori"] },
      { itemId: "i0b", name: "Tandoori Chicken Tikka", price: 329, tags: ["non-veg", "chicken", "smoky", "tandoori", "high-protein"] },
      { itemId: "i0c", name: "Roomali Roti", price: 39, tags: ["veg", "side", "bread"] },
      { itemId: "i0d", name: "Mint Chutney Cup", price: 29, tags: ["vegan", "veg", "side", "mint", "cooling"] }
    ]
  },
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
  },
  {
    id: "r11",
    name: "Wok & Fizz",
    cuisine: "Chinese",
    rating: 4.6,
    distanceKm: 1.7,
    availabilityStatus: "OPEN",
    priceBand: 290,
    tags: ["chinese", "indo-chinese", "spicy", "noodles", "office-friendly", "familiar"],
    items: [
      { itemId: "i21", name: "Smoky Chicken Hakka Noodles", price: 289, tags: ["non-veg", "chicken", "noodles", "chinese", "smoky"] },
      { itemId: "i22", name: "Veg Schezwan Fried Rice", price: 249, tags: ["vegan", "veg", "friedrice", "rice", "chinese", "spicy"] },
      { itemId: "i23", name: "Chilli Paneer Dry", price: 269, tags: ["veg", "paneer", "chinese", "spicy", "high-protein"] },
      { itemId: "i24", name: "Crispy Spring Rolls", price: 129, tags: ["veg", "side", "crispy", "chinese"] }
    ]
  },
  {
    id: "r12",
    name: "Momo Weather",
    cuisine: "Tibetan",
    rating: 4.4,
    distanceKm: 1.1,
    availabilityStatus: "OPEN",
    priceBand: 230,
    tags: ["momos", "dumplings", "spicy", "comfort", "budget"],
    items: [
      { itemId: "i25", name: "Kurkure Chicken Momos", price: 239, tags: ["non-veg", "chicken", "momos", "crunchy", "spicy"] },
      { itemId: "i26", name: "Steamed Paneer Momos", price: 199, tags: ["veg", "paneer", "momos", "chewy"] },
      { itemId: "i27", name: "Fiery Momo Chutney", price: 29, tags: ["vegan", "veg", "side", "spicy"] }
    ]
  },
  {
    id: "r13",
    name: "The Burger Foundry",
    cuisine: "American",
    rating: 4.5,
    distanceKm: 2.2,
    availabilityStatus: "OPEN",
    priceBand: 330,
    tags: ["burger", "fries", "comfort", "familiar", "office-friendly"],
    items: [
      { itemId: "i28", name: "Smash Chicken Cheeseburger", price: 319, tags: ["non-veg", "chicken", "burger", "cheesy", "comfort"] },
      { itemId: "i29", name: "Crispy Paneer Burger", price: 269, tags: ["veg", "paneer", "burger", "crispy"] },
      { itemId: "i30", name: "Sea Salt Fries", price: 99, tags: ["vegan", "veg", "side", "fries", "crispy"] }
    ]
  },
  {
    id: "r14",
    name: "Pasta Atelier",
    cuisine: "Italian",
    rating: 4.6,
    distanceKm: 2.7,
    availabilityStatus: "OPEN",
    priceBand: 390,
    tags: ["italian", "pasta", "creamy", "novel"],
    items: [
      { itemId: "i31", name: "Truffle Mushroom Penne", price: 389, tags: ["veg", "pasta", "creamy", "mushroom", "italian"] },
      { itemId: "i32", name: "Spicy Chicken Arrabbiata", price: 419, tags: ["non-veg", "chicken", "pasta", "spicy", "italian"] },
      { itemId: "i33", name: "Roasted Garlic Bread", price: 109, tags: ["veg", "side", "bread", "garlic"] }
    ]
  },
  {
    id: "r15",
    name: "Coast & Curry",
    cuisine: "Coastal Indian",
    rating: 4.7,
    distanceKm: 3.0,
    availabilityStatus: "OPEN",
    priceBand: 420,
    tags: ["fish", "seafood", "coastal", "rice", "novel", "non-veg"],
    items: [
      { itemId: "i34", name: "Mangalorean Fish Curry Rice", price: 399, tags: ["non-veg", "fish", "seafood", "rice", "spicy"] },
      { itemId: "i35", name: "Prawn Ghee Roast Bowl", price: 449, tags: ["non-veg", "prawn", "seafood", "spicy", "high-protein"] },
      { itemId: "i36", name: "Sol Kadhi", price: 69, tags: ["veg", "side", "beverage", "cooling"] }
    ]
  },
  {
    id: "r16",
    name: "Dosa District",
    cuisine: "South Indian",
    rating: 4.5,
    distanceKm: 1.5,
    availabilityStatus: "OPEN",
    priceBand: 210,
    tags: ["south-indian", "dosa", "breakfast", "comfort", "veg", "familiar"],
    items: [
      { itemId: "i37", name: "Ghee Podi Masala Dosa", price: 199, tags: ["veg", "dosa", "crispy", "spicy", "comfort"] },
      { itemId: "i38", name: "Jain Mini Idli Sambar", price: 179, tags: ["vegan", "veg", "jain", "no-onion-garlic", "light"] },
      { itemId: "i39", name: "Filter Coffee", price: 59, tags: ["veg", "side", "beverage", "coffee"] }
    ]
  },
  {
    id: "r17",
    name: "Levant Table",
    cuisine: "Lebanese",
    rating: 4.6,
    distanceKm: 2.6,
    availabilityStatus: "OPEN",
    priceBand: 350,
    tags: ["lebanese", "wrap", "grill", "healthy", "high-protein", "novel"],
    items: [
      { itemId: "i40", name: "Chicken Shawarma Meal", price: 349, tags: ["non-veg", "chicken", "wrap", "lebanese", "high-protein"] },
      { itemId: "i41", name: "Falafel Hummus Bowl", price: 299, tags: ["vegan", "veg", "lebanese", "high-protein", "healthy"] },
      { itemId: "i42", name: "Za'atar Pita Crisps", price: 89, tags: ["vegan", "veg", "side", "crispy"] }
    ]
  },
  {
    id: "r18",
    name: "Ramen After Rain",
    cuisine: "Japanese",
    rating: 4.5,
    distanceKm: 3.3,
    availabilityStatus: "OPEN",
    priceBand: 450,
    tags: ["japanese", "ramen", "noodles", "rainy", "comfort", "novel"],
    items: [
      { itemId: "i43", name: "Spicy Chicken Miso Ramen", price: 449, tags: ["non-veg", "chicken", "ramen", "noodles", "spicy", "comfort"] },
      { itemId: "i44", name: "Tofu Sesame Ramen", price: 399, tags: ["vegan", "veg", "tofu", "ramen", "noodles"] },
      { itemId: "i45", name: "Edamame Sea Salt", price: 119, tags: ["vegan", "veg", "side", "high-protein"] }
    ]
  },
  {
    id: "r19",
    name: "Cantina Verde",
    cuisine: "Mexican",
    rating: 4.3,
    distanceKm: 2.5,
    availabilityStatus: "OPEN",
    priceBand: 340,
    tags: ["mexican", "tacos", "bowl", "spicy", "sharing", "novel"],
    items: [
      { itemId: "i46", name: "Chipotle Chicken Burrito Bowl", price: 349, tags: ["non-veg", "chicken", "mexican", "spicy", "high-protein"] },
      { itemId: "i47", name: "Jain Bean & Corn Tacos", price: 299, tags: ["vegan", "veg", "jain", "no-onion-garlic", "tacos", "mexican"] },
      { itemId: "i48", name: "Salsa & Corn Chips", price: 99, tags: ["vegan", "veg", "side", "crispy"] }
    ]
  },
  {
    id: "r20",
    name: "Bombay Chaat Radio",
    cuisine: "Street Food",
    rating: 4.4,
    distanceKm: 1.0,
    availabilityStatus: "OPEN",
    priceBand: 180,
    tags: ["chaat", "street-food", "tangy", "spicy", "budget", "veg"],
    items: [
      { itemId: "i49", name: "Crunchy Papdi Chaat", price: 149, tags: ["veg", "chaat", "crunchy", "tangy", "spicy"] },
      { itemId: "i50", name: "Jain Bhel Cup", price: 129, tags: ["vegan", "veg", "jain", "no-onion-garlic", "chaat", "light"] },
      { itemId: "i51", name: "Masala Nimbu Soda", price: 59, tags: ["vegan", "veg", "side", "beverage", "cooling"] }
    ]
  },
  {
    id: "r21",
    name: "Mithai & Melt",
    cuisine: "Indian Dessert",
    rating: 4.7,
    distanceKm: 1.9,
    availabilityStatus: "OPEN",
    priceBand: 240,
    tags: ["dessert", "sweet", "comfort", "gulab-jamun", "ice-cream", "veg", "familiar"],
    items: [
      {
        itemId: "i52",
        name: "Warm Gulab Jamun & Vanilla Ice Cream",
        price: 229,
        tags: ["veg", "dessert", "sweet", "comfort", "gulab-jamun", "ice-cream", "combo"]
      },
      { itemId: "i53", name: "Mini Gulab Jamun Box", price: 159, tags: ["veg", "dessert", "sweet", "gulab-jamun", "sharing"] },
      { itemId: "i54", name: "Kesar Kulfi Stick", price: 89, tags: ["veg", "dessert", "sweet", "ice-cream"] }
    ]
  }
];

const fixtureProducts = [
  { productId: "p1", name: "Tender Coconut Water", price: 79, tags: ["beverage", "cooling", "healthy"] },
  { productId: "p2", name: "Seasonal Fruit Box", price: 149, tags: ["fruit", "office-friendly"] },
  { productId: "p3", name: "Roasted Makhana", price: 119, tags: ["snack", "high-protein"] },
  { productId: "p4", name: "Paper Plates Pack", price: 99, tags: ["office-supply", "office-friendly"] },
  { productId: "p5", name: "Chilled Cola Can Pack", price: 120, tags: ["cold-drink", "cola", "chinese", "pizza", "burger", "momos", "office-friendly"] },
  { productId: "p6", name: "Zero Sugar Cola", price: 45, tags: ["cold-drink", "cola", "chinese", "pizza", "burger"] },
  { productId: "p7", name: "Mint Lemon Sparkler", price: 69, tags: ["beverage", "mint", "chaap", "tandoori", "cooling"] },
  { productId: "p8", name: "Classic Curd Cup", price: 55, tags: ["raita", "biryani", "rice", "cooling"] },
  { productId: "p9", name: "Mango Ice Cream Tub", price: 189, tags: ["dessert", "spicy", "chinese", "biryani", "office-friendly"] },
  { productId: "p10", name: "Sparkling Water", price: 60, tags: ["beverage", "italian", "pasta", "healthy"] },
  { productId: "p11", name: "Chocolate Brownie Bites", price: 159, tags: ["dessert", "pizza", "burger", "office-friendly"] },
  { productId: "p12", name: "Fresh Lime Soda", price: 65, tags: ["beverage", "seafood", "coastal", "mexican", "cooling"] }
];

export function createSwiggyGateway({ userId } = {}) {
  const mode = process.env.SWIGGY_MODE || "fixture";
  if (mode === "live") return liveGateway(userId);
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
    async searchMenu({ query = "", addressId, restaurantIdOfAddedItem, vegFilter = 0 }) {
      void addressId;
      const tokens = expandIntentTokens(query);
      return fixtureRestaurants
        .filter((restaurant) => !restaurantIdOfAddedItem || restaurant.id === restaurantIdOfAddedItem)
        .flatMap((restaurant) =>
          restaurant.items
            .filter((item) => {
              if (vegFilter === 1 && (item.tags.includes("non-veg") || item.tags.includes("egg"))) return false;
              const haystack = [item.name, ...item.tags, restaurant.name, restaurant.cuisine, ...restaurant.tags]
                .join(" ")
                .toLowerCase();
              return !tokens.length || tokens.some((token) => haystack.includes(token));
            })
            .map((item) => ({ ...item, restaurant }))
        );
    },
    async getRestaurantMenu({ restaurantId, addressId }) {
      void addressId;
      const restaurant = fixtureRestaurants.find((item) => item.id === restaurantId);
      if (!restaurant) {
        const error = new Error("Restaurant not found");
        error.status = 404;
        throw error;
      }
      return { restaurantId, items: restaurant.items, restaurant };
    },
    async searchProducts({ query = "", addressId }) {
      void addressId;
      const q = query.toLowerCase();
      return fixtureProducts.filter((product) => !q || product.tags.some((tag) => tag.includes(q)) || product.name.toLowerCase().includes(q));
    },
    async getFoodCart({ addressId } = {}) {
      return { cartId: null, addressId, restaurantId: "", restaurant: "", items: [], total: 0, mode: "fixture" };
    },
    async buildFoodCart({ restaurantId, addressId, items }) {
      const menu = await this.getRestaurantMenu({ restaurantId, addressId });
      const cartItems = items.map((wanted) => {
        const item = menu.items.find((candidate) => candidate.itemId === wanted.itemId);
        return { ...item, quantity: wanted.quantity || 1 };
      });
      return {
        cartId: `cart_${restaurantId}`,
        addressId,
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
    chinese: ["chinese", "indo-chinese", "noodles", "spicy"],
    chowmein: ["noodles", "chinese"],
    noodles: ["noodles", "chinese", "ramen"],
    momos: ["momos", "dumplings", "spicy"],
    burger: ["burger", "fries", "comfort"],
    pasta: ["pasta", "italian", "creamy"],
    ramen: ["ramen", "noodles", "japanese"],
    tacos: ["tacos", "mexican", "spicy"],
    fish: ["fish", "seafood", "coastal"],
    dosa: ["dosa", "south-indian", "breakfast"],
    gulab: ["gulab-jamun", "dessert", "sweet", "comfort"],
    jamun: ["gulab-jamun", "dessert", "sweet"],
    icecream: ["ice-cream", "dessert", "sweet"],
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

function liveGateway(userId) {
  const callTool = createLiveCaller(userId);
  const warnings = [];
  const menus = new Map();
  const menuFor = async args => {
    const key = `${args.addressId}:${args.restaurantId}`;
    if (!menus.has(key)) menus.set(key, callTool("food", "get_restaurant_menu", args).then(data => normalizeRestaurantMenu(data, args)));
    return menus.get(key);
  };
  return {
    mode: "live", userId, warnings,
    getAddresses: async () => normalizeAddresses(await callTool("food", "get_addresses")),
    searchMenu: async args => {
      const items = normalizeMenuSearch(await callTool("food", "search_menu", args));
      for (const id of [...new Set(items.map(i => i.restaurant.id))].slice(0, 12)) {
        const menu = await menuFor({ restaurantId: id, addressId: args.addressId });
        if (menu.restaurant) for (const item of items.filter(i => i.restaurant.id === id)) item.restaurant = normalizeRestaurants([menu.restaurant])[0];
      }
      return items.filter(i => Number.isFinite(i.price) && i.inStock !== 0 && i.inStock !== false);
    },
    searchRestaurants: async args => normalizeRestaurants(await callTool("food", "search_restaurants", args)),
    getRestaurantMenu: menuFor,
    searchProducts: async args => {
      try { return normalizeProducts(await callTool("im", "search_products", args)); }
      catch (error) {
        if (error.status === 401) throw error;
        if (!warnings.some(w => w.service === "instamart")) warnings.push({ service: "instamart", message: "Instamart suggestions are unavailable. Food results are still live." });
        return [];
      }
    },
    getFoodCart: async args => normalizeFoodCart(await callTool("food", "get_food_cart", args)),
    buildFoodCart: async ({ restaurantId, addressId, items }) => {
      await callTool("food", "update_food_cart", { restaurantId, addressId, cartItems: items.map(item => ({
        menu_item_id: item.itemId, quantity: item.quantity,
        ...(item.variants ? { variants: item.variants } : {}),
        ...(item.variantsV2 ? { variantsV2: item.variantsV2 } : {}),
        ...(item.addons ? { addons: item.addons } : {})
      })) });
      return { ...normalizeFoodCart(await callTool("food", "get_food_cart", { addressId })), mutationApplied: true };
    }
  };
}

export function normalizeFoodCart(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || (data.items !== undefined && !Array.isArray(data.items))) throw upstreamError("Swiggy returned an unrecognized cart. Check your Swiggy cart before continuing.");
  const items = arrayFrom(data, ["items"]).map(item => ({ ...item,
    itemId: validId(item.menu_item_id ?? item.itemId ?? item.id), quantity: Number(item.quantity),
    price: Number(item.final_price ?? item.price ?? item.subtotal), name: String(item.name || "Item")
  }));
  const total = Number(data.pricing?.to_pay ?? data.total ?? (items.length === 0 ? 0 : NaN));
  if (!Number.isFinite(total)) throw upstreamError("Swiggy cart total is missing");
  return { cartId: data.cart_id ?? data.cartId, restaurantId: String(data.restaurant?.id ?? data.restaurantId ?? ""),
    restaurant: data.restaurant?.name ?? data.restaurantName ?? (typeof data.restaurant === "string" ? data.restaurant : ""),
    items, total, pricing: data.pricing, offers: data.offers, mode: "live" };
}
function validId(value) {
  if (value === undefined || value === null || String(value) === "") throw upstreamError("Swiggy returned an item without an identifier");
  return String(value);
}

function normalizeAddresses(data) {
  const addresses = arrayFrom(data, ["addresses", "items"]);
  return addresses.map((address) => ({
    ...address,
    id: validId(address.id ?? address.addressId),
    label: address.label || address.type || "Saved address",
    display: address.display || address.address || address.formattedAddress || ""
  }));
}

function normalizeRestaurants(data) {
  return arrayFrom(data, ["restaurants", "items"]).map((restaurant) => ({
    ...restaurant,
    id: validId(restaurant.id ?? restaurant.restaurantId),
    name: restaurant.name || restaurant.restaurantName,
    cuisine: Array.isArray(restaurant.cuisines) ? restaurant.cuisines.join(", ") : restaurant.cuisine || "Mixed",
    rating: Number(restaurant.rating || restaurant.avgRating || 0),
    distanceKm: Number(restaurant.distanceKm || restaurant.distance || 0),
    priceBand: Number(restaurant.priceBand || restaurant.costForTwo / 2 || 0),
    availabilityStatus: restaurant.availabilityStatus || (restaurant.isOpen === true ? "OPEN" : "UNKNOWN"),
    tags: [...new Set([...(restaurant.tags || []), ...(restaurant.cuisines || [])].map(String))],
    items: restaurant.items || []
  }));
}

function normalizeMenuSearch(data) {
  return arrayFrom(data, ["items", "menuItems", "results"]).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const rawRestaurant = entry.restaurant || entry.restaurantInfo || { id: entry.restaurant_id, name: entry.restaurant_name };
    const itemId = entry.menu_item_id ?? entry.itemId ?? entry.id;
    const restaurantId = rawRestaurant.id ?? rawRestaurant.restaurantId;
    if ([itemId, restaurantId].some(id => id === undefined || id === null || String(id).trim() === "")) return [];
    return {
      ...entry,
      itemId: validId(itemId),
      name: entry.name || entry.itemName,
      price: Number(entry.price ?? entry.defaultPrice ?? NaN),
      tags: normalizeItemTags(entry),
      restaurant: normalizeRestaurants({ restaurants: [rawRestaurant] })[0]
    };
  }).filter((entry) => entry.restaurant?.id && entry.itemId);
}

function normalizeRestaurantMenu(data, args) {
  const items = arrayFrom(data, ["items", "menuItems", "results", "categories"]).flatMap((entry) =>
    Array.isArray(entry.items) ? entry.items : [entry]
  );
  return {
    restaurantId: args.restaurantId,
    restaurant: data.restaurant,
    items: items.map((item) => ({
      ...item,
      itemId: validId(item.menu_item_id ?? item.itemId ?? item.id),
      name: item.name || item.itemName,
      price: Number(item.price ?? item.defaultPrice ?? NaN),
      tags: normalizeItemTags(item)
    }))
  };
}

function normalizeProducts(data) {
  return arrayFrom(data, ["products", "items", "results"]).flatMap(product => {
    if (product.inStock === false || product.isAvail === false) return [];
    if (Array.isArray(product.variations)) return product.variations
      .filter(v => v.isInStockAndAvailable === true && Number.isFinite(v.price?.offerPrice))
      .map(v => ({ ...v, productId: validId(v.spinId), parentProductId: product.productId,
        name: `${v.displayName || product.displayName} · ${v.quantityDescription}`, price: v.price.offerPrice,
        tags: (product.tags || []).map(String) }));
    const price = Number(product.price ?? product.finalPrice ?? NaN);
    return Number.isFinite(price) ? [{ ...product, productId: validId(product.productId ?? product.id ?? product.spinId),
      name: product.name || product.displayName || product.productName, price, tags: (product.tags || []).map(String) }] : [];
  });
}

function normalizeItemTags(item) {
  const tags = [...(item.tags || [])].map((tag) => String(tag).toLowerCase());
  if (item.isVeg === true || item.veg === true || item.is_veg === true || item.is_veg === 1 || item.is_veg === "1") tags.push("veg");
  if (item.isVeg === false || item.veg === false || item.is_veg === false || item.is_veg === 0 || item.is_veg === "0") tags.push("non-veg");
  return [...new Set(tags)];
}

function arrayFrom(data, keys) {
  if (Array.isArray(data)) return data;
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  return [];
}
