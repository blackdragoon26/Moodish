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
- `build_confirmed_cart`: builds a cart only when `confirmed: true`.
- `update_taste_profile`: updates taste memory.
- `record_meal_feedback`: stores feedback tags and notes.
- `get_taste_memory`: exports taste profile and feedback.

## Safety Contract

- The server never places live orders in this v1.
- Cart build requires explicit confirmation.
- Live Swiggy mode must keep OAuth and token storage server-side.
- Any future checkout tool must require separate confirmation of address, items, total, and payment mode.
