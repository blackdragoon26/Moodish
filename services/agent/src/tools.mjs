import { DEFAULT_USER_HASH } from "./contracts.mjs";
import {
  exportTasteMemory,
  getRecommendation,
  getTasteProfile,
  getTeamProfile,
  recordFeedback,
  saveRecommendation,
  updateTasteProfile
} from "./memory.mjs";
import { buildConfirmedCart, planOfficeLunch, planPersonalMeal } from "./recommender.mjs";
import { createAiProvider } from "./ai-provider.mjs";
import { createSwiggyGateway } from "./swiggy-gateway.mjs";
import { instrumentToolCall } from "./telemetry.mjs";

export function createToolRuntime() {
  const swiggy = createSwiggyGateway();
  const ai = createAiProvider();
  return { swiggy, ai };
}

export function createTools(runtime = createToolRuntime()) {
  return {
    async plan_personal_meal(args = {}) {
      const userIdHash = args.userIdHash || DEFAULT_USER_HASH;
      return instrumentToolCall({ tool: "plan_personal_meal", userIdHash }, async () => {
        const run = await planPersonalMeal({
          request: args,
          tasteProfile: getTasteProfile(userIdHash),
          swiggy: runtime.swiggy,
          ai: runtime.ai
        });
        return saveRecommendation(run);
      });
    },
    async plan_office_lunch(args = {}) {
      const userIdHash = args.userIdHash || DEFAULT_USER_HASH;
      return instrumentToolCall({ tool: "plan_office_lunch", userIdHash }, async () => {
        const run = await planOfficeLunch({
          request: args,
          teamProfile: getTeamProfile(args.teamId),
          swiggy: runtime.swiggy,
          ai: runtime.ai
        });
        return saveRecommendation(run);
      });
    },
    async build_confirmed_cart(args = {}) {
      const userIdHash = args.userIdHash || DEFAULT_USER_HASH;
      return instrumentToolCall(
        { tool: "build_confirmed_cart", userIdHash, recommendationId: args.recommendationId },
        async () => {
          const recommendation = getRecommendation(args.recommendationId);
          if (!recommendation) {
            const error = new Error("Unknown recommendationId");
            error.status = 404;
            throw error;
          }
          return buildConfirmedCart({
            recommendation,
            optionId: args.optionId,
            confirmed: args.confirmed === true,
            swiggy: runtime.swiggy
          });
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
    }
  };
}
