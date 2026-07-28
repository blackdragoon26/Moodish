import { DEFAULT_USER_HASH } from "./contracts.mjs";
import {
  exportTasteMemory,
  getMealHistory,
  getRecommendation,
  getTasteProfile,
  getTeamProfile,
  recordFeedback,
  recordMealHistory,
  saveRecommendation,
  updateTasteProfile
} from "./memory.mjs";
import { buildConfirmedCart, planOfficeLunch, planPersonalMeal } from "./recommender.mjs";
import { createAiProvider } from "./ai-provider.mjs";
import { createSwiggyGateway } from "./swiggy-gateway.mjs";
import { instrumentToolCall } from "./telemetry.mjs";
import {
  cancelGroupSession,
  confirmGroupCart,
  createGroupSession,
  getGroupSessionView,
  lockAndRankGroupSession,
  selectGroupOption,
  submitGroupPreference,
  verifyGroupInviteAccess,
  voteGroupOption
} from "./group-service.mjs";

export function createToolRuntime() {
  const swiggy = createSwiggyGateway();
  const ai = createAiProvider();
  return { swiggy, ai };
}

export function createTools(runtime = createToolRuntime()) {
  return {
    async interpret_meal_message(args = {}) {
      const provider = aiForRequest(args, runtime.ai);
      if (typeof provider.interpretMealMessage !== "function") return null;
      return provider.interpretMealMessage({
        message: String(args.message || ""),
        previous: args.previous && typeof args.previous === "object" ? args.previous : {}
      });
    },
    async plan_personal_meal(args = {}) {
      const userIdHash = args.userIdHash || DEFAULT_USER_HASH;
      return instrumentToolCall({ tool: "plan_personal_meal", userIdHash }, async () => {
        const tasteProfile = await getTasteProfile(userIdHash);
        const recentMeals = await getMealHistory(userIdHash, 10);
        const run = await planPersonalMeal({
          request: publicRequest(args),
          tasteProfile: {
            ...tasteProfile,
            recentMeals,
            weeklyCuisineHistory: [
              ...recentMeals.map((meal) => meal.cuisine).filter(Boolean),
              ...(tasteProfile.weeklyCuisineHistory || [])
            ].slice(0, 12)
          },
          swiggy: runtime.swiggy,
          ai: aiForRequest(args, runtime.ai)
        });
        return saveRecommendation(run);
      });
    },
    async plan_office_lunch(args = {}) {
      const userIdHash = args.userIdHash || DEFAULT_USER_HASH;
      return instrumentToolCall({ tool: "plan_office_lunch", userIdHash }, async () => {
        const run = await planOfficeLunch({
          request: publicRequest(args),
          teamProfile: await getTeamProfile(args.teamId),
          swiggy: runtime.swiggy,
          ai: aiForRequest(args, runtime.ai)
        });
        return await saveRecommendation(run);
      });
    },
    async build_confirmed_cart(args = {}) {
      const userIdHash = args.userIdHash || DEFAULT_USER_HASH;
      return instrumentToolCall(
        { tool: "build_confirmed_cart", userIdHash, recommendationId: args.recommendationId },
        async () => {
          const recommendation = await getRecommendation(args.recommendationId);
          if (!recommendation) {
            const error = new Error("Unknown recommendationId");
            error.status = 404;
            throw error;
          }
          const cart = await buildConfirmedCart({
            recommendation,
            optionId: args.optionId,
            addOnProductIds: args.addOnProductIds,
            confirmed: args.confirmed === true,
            swiggy: runtime.swiggy
          });
          const option =
            recommendation.options.find((candidate) => candidate.optionId === args.optionId) ||
            recommendation.options[0];
          const selectedAddOnIds = new Set(args.addOnProductIds || []);
          const selectedAddOns = (recommendation.addOns || []).filter((item) =>
            selectedAddOnIds.has(item.productId)
          );
          const mealMemoryEntry = await recordMealHistory({
            userIdHash,
            recommendationId: recommendation.recommendationId,
            restaurantName: option?.restaurantName,
            cuisine: option?.cuisine,
            items: option?.items?.map((item) => ({ name: item.name, quantity: item.quantity })) || [],
            addOns: selectedAddOns.map((item) => ({ name: item.name, price: item.price })),
            foodTotal: cart.foodCart.total,
            instamartTotal: cart.instamartCartPreview.total,
            dataSource: recommendation.transparency?.dataSource || "fixture"
          });
          return { ...cart, mealMemoryEntry };
        }
      );
    },
    async update_taste_profile(args = {}) {
      const userIdHash = args.userIdHash || DEFAULT_USER_HASH;
      return updateTasteProfile(userIdHash, args.patch || args);
    },
    async record_meal_feedback(args = {}) {
      return recordFeedback({
        userIdHash: args.userIdHash || DEFAULT_USER_HASH,
        orderId: args.orderId || args.recommendationId || "fixture-order",
        rating: args.rating,
        tags: args.tags || [],
        notes: args.notes || ""
      });
    },
    async get_taste_memory(args = {}) {
      return exportTasteMemory(args.userIdHash || DEFAULT_USER_HASH);
    },
    async create_group_meal_session(args = {}) {
      return createGroupSession(args);
    },
    async submit_group_preferences(args = {}) {
      return submitGroupPreference(args);
    },
    async verify_group_invite_access(args = {}) {
      return verifyGroupInviteAccess(args);
    },
    async rank_group_meal(args = {}) {
      return lockAndRankGroupSession(args, runtime);
    },
    async vote_group_option(args = {}) {
      return voteGroupOption(args);
    },
    async select_group_option(args = {}) {
      return selectGroupOption(args);
    },
    async confirm_group_cart(args = {}) {
      return confirmGroupCart(args, runtime);
    },
    async get_group_meal_session(args = {}) {
      return getGroupSessionView(args);
    },
    async cancel_group_meal_session(args = {}) {
      return cancelGroupSession(args);
    }
  };
}

function aiForRequest(args, defaultAi) {
  if (!args.aiApiKey) return defaultAi;
  return createAiProvider({
    overrides: {
      provider: "openrouter",
      apiKey: String(args.aiApiKey),
      model: args.aiModel ? String(args.aiModel) : undefined
    }
  });
}

function publicRequest(args = {}) {
  const { aiApiKey, aiModel, ...rest } = args;
  void aiApiKey;
  return aiModel ? { ...rest, aiModel } : rest;
}
