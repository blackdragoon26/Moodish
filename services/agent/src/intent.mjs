const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "anything",
  "food",
  "for",
  "have",
  "i",
  "like",
  "me",
  "much",
  "of",
  "please",
  "something",
  "that",
  "the",
  "to",
  "very",
  "want",
  "with"
]);

const DISH_TERMS = new Set([
  "biryani",
  "burger",
  "chaap",
  "chicken",
  "chowmein",
  "chocolate",
  "dessert",
  "dosa",
  "fish",
  "friedrice",
  "gulab",
  "icecream",
  "momos",
  "noodles",
  "paratha",
  "pasta",
  "pizza",
  "ramen",
  "roll",
  "salad",
  "sandwich",
  "tacos",
  "thali",
  "wrap"
]);

const DISH_PHRASES = [
  ["gulab jamun", "gulab-jamun"],
  ["ice cream", "ice-cream"],
  ["fried rice", "fried-rice"],
  ["hakka noodles", "hakka-noodles"]
];

const ATTRIBUTE_TERMS = new Set([
  "chewy",
  "comfort",
  "creamy",
  "crunchy",
  "fresh",
  "healthy",
  "heavy",
  "light",
  "smoky",
  "spicy",
  "sweet",
  "tangy",
  "tasty"
]);

const CUISINE_PHRASES = [
  ["north indian", "North Indian"],
  ["south indian", "South Indian"],
  ["punjabi", "North Indian"],
  ["bengali", "Bengali"],
  ["thai", "Thai"],
  ["chinese", "Chinese"],
  ["indo chinese", "Chinese"],
  ["italian", "Italian"],
  ["japanese", "Japanese"],
  ["mexican", "Mexican"],
  ["lebanese", "Lebanese"],
  ["continental", "Continental"]
];

const ALTERNATIVE_QUERIES = {
  chaap: ["soya chaap", "paneer tikka", "tandoori"],
  biryani: ["rice bowl", "pulao"],
  burger: ["sandwich", "wrap"],
  chicken: ["high protein", "tandoori"],
  chowmein: ["noodles", "fried rice"],
  dosa: ["south indian", "idli"],
  fish: ["seafood", "coastal"],
  momos: ["dumplings", "rolls"],
  noodles: ["chowmein", "fried rice"],
  pasta: ["italian", "pizza"],
  pizza: ["flatbread", "sharing"],
  ramen: ["noodles", "japanese"],
  tacos: ["wrap", "mexican"],
  salad: ["healthy bowl", "fresh"]
};

export function extractMealIntent(value = "") {
  const raw = String(value).trim();
  const normalized = raw.toLowerCase();
  const tokens = normalized.match(/[a-z0-9]+/g) || [];
  const meaningfulTokens = [...new Set(tokens.filter((token) => token.length > 1 && !STOP_WORDS.has(token)))];
  const phraseDishes = DISH_PHRASES.filter(([phrase]) => normalized.includes(phrase)).map(([, dish]) => dish);
  const tokenDishes = meaningfulTokens.filter((token) => DISH_TERMS.has(token));
  const dishes = [...new Set([...phraseDishes, ...tokenDishes])];
  const attributes = meaningfulTokens.filter((token) => ATTRIBUTE_TERMS.has(token));
  const cuisines = CUISINE_PHRASES.filter(([phrase]) => normalized.includes(phrase)).map(([, cuisine]) => cuisine);
  const primaryDish = dishes[0] || null;
  const exactQuery = primaryDish || meaningfulTokens.slice(0, 4).join(" ") || "popular";
  return {
    raw,
    tokens: meaningfulTokens,
    dishes,
    attributes,
    cuisines: [...new Set(cuisines)],
    primaryDish,
    exactQuery,
    alternativeQueries: primaryDish ? ALTERNATIVE_QUERIES[primaryDish] || [] : [],
    hasExplicitDish: Boolean(primaryDish)
  };
}

export function normalizeDiscoveryMode({ discoveryMode, novelty } = {}) {
  if (["comfort", "balanced", "explore"].includes(discoveryMode)) return discoveryMode;
  const legacy = Number(novelty);
  if (Number.isFinite(legacy)) {
    if (legacy <= 2) return "comfort";
    if (legacy >= 4) return "explore";
  }
  return "balanced";
}

export function normalizeDietMode(value) {
  const normalized = String(value || "both")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (normalized === "veg" || normalized === "vegetarian") return "veg";
  if (normalized === "non_veg" || normalized === "nonveg" || normalized === "non_vegetarian") return "non_veg";
  return "both";
}
