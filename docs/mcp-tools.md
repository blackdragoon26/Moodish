# Moodish MCP Tools

Moodish exposes a generic JSON-RPC endpoint at `/mcp` so any AI client can use the product without depending on one model vendor.

## Endpoint

```http
POST /mcp
content-type: application/json
```

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "tools/call",
  "params": {
    "name": "plan_personal_meal",
    "arguments": {
      "budget": 350,
      "mood": "curious",
      "dietaryRules": "high-protein",
      "novelty": 4
    }
  }
}
```

## Tools

- `plan_personal_meal`: returns 2-3 ranked meal options for one user.
- `plan_office_lunch`: returns 2-3 ranked office lunch options plus Instamart add-ons.
- `build_confirmed_cart`: builds a Food cart only when `confirmed: true`; optional `addOnProductIds` are validated against the recommendation and returned as a separate Instamart cart preview.
- `update_taste_profile`: updates taste memory.
- `record_meal_feedback`: stores feedback tags and notes.
- `get_taste_memory`: exports taste profile and feedback.
- `create_group_meal_session`: creates a persistent cross-platform collection session.
- `submit_group_preferences`: records a participant's private meal constraints.
- `rank_group_meal`: locks collection and creates one-restaurant-first plans.
- `vote_group_option`: records or replaces a participant vote.
- `select_group_option`: lets a creator or co-manager approve a finalist.
- `confirm_group_cart`: builds the selected cart only for the session creator.
- `get_group_meal_session`: returns a private manager view or redacted public view.
- `cancel_group_meal_session`: cancels an unfinished session.

`plan_personal_meal` prefers the new `maxBudget`, `dietMode`, and `discoveryMode` arguments. Numeric `novelty` remains a deprecated compatibility input.

## Safety Contract

- The server never places live orders in this v1.
- Cart build requires explicit confirmation.
- Live Swiggy mode must keep OAuth and token storage server-side.
- Any future checkout tool must require separate confirmation of address, items, total, and payment mode.
