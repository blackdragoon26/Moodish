import Foundation

/// `itemId` is present on personal-recommendation items but absent on the
/// lighter `{name, quantity}` items a group session's ranked `options`
/// return (group-service.mjs coverage options) — optional here so both
/// shapes decode.
struct MealItem: Codable, Equatable, Identifiable {
    var id: String { itemId ?? name }
    let itemId: String?
    let name: String
    let quantity: Int?
    let restaurantId: String?
    let restaurantName: String?
    let tags: [String]?
}

struct AddOnProduct: Codable, Equatable, Identifiable {
    var id: String { productId }
    let productId: String
    let name: String
    let price: Double
    let pairingReason: String?
}

struct FoodSource: Codable, Equatable, Identifiable {
    var id: String { restaurantId }
    let restaurantId: String
    let restaurantName: String
}

/// How many submitted group-session requests this option's coverage plan
/// satisfies vs. needs a compromise item for - same "coverage" key on both
/// the trimmed public view and the full manager/creator view (the full
/// view additionally carries a per-participant `participants` breakdown
/// that isn't modeled here).
struct CoverageSummary: Codable, Equatable {
    let totalParticipants: Int
    let satisfiedCount: Int
    let compromiseCount: Int
}

struct RecommendationOption: Codable, Equatable, Identifiable {
    var id: String { optionId }
    let optionId: String
    let restaurantName: String
    let cuisine: String?
    let items: [MealItem]
    let estimatedTotal: Double
    let rating: Double?
    let distanceKm: Double?
    let matchType: String?
    let reasons: [String]?
    /// True when this option's items are drawn from more than one
    /// restaurant to cover every teammate's request (group flow only).
    let splitOrder: Bool?
    let foodSources: [FoodSource]?
    let coverage: CoverageSummary?
}

/// Personal recommendations return `orderPlacementEnabled`; the office/group
/// variant instead returns `groupPaymentSupported`/`scheduledDeliverySupported`
/// (recommender.mjs office path) — all optional here so both decode.
struct SafetyInfo: Codable, Equatable {
    let requiresCartConfirmation: Bool
    let orderPlacementEnabled: Bool?
    let groupPaymentSupported: Bool?
    let scheduledDeliverySupported: Bool?
    let note: String?
}

struct DemoInfo: Codable, Equatable {
    let active: Bool
    let label: String?
    let note: String?
}

struct RecommendationRun: Codable, Equatable {
    let recommendationId: String
    let mode: String?
    let options: [RecommendationOption]
    let addOns: [AddOnProduct]
    let summary: String?
    let demo: DemoInfo?
    let safety: SafetyInfo?
}

struct CartSummary: Codable, Equatable {
    let restaurant: String?
    let items: [MealItem]?
    let total: Double?
}

struct InstamartPreview: Codable, Equatable {
    let items: [AddOnProduct]?
    let total: Double?
    let note: String?
}

struct CartConfirmResult: Codable, Equatable {
    let recommendationId: String?
    /// First-restaurant convenience view - the personal flow never splits,
    /// but a group cart can span multiple restaurants (`foodCarts`) to cover
    /// every teammate's request. Prefer `foodCarts` when present.
    let foodCart: CartSummary?
    let foodCarts: [CartSummary]?
    let splitOrder: Bool?
    let instamartCartPreview: InstamartPreview?
    let explicitConfirmationCaptured: Bool?
    let checkoutBlocked: Bool
    let checkoutNote: String?
    let mealMemoryEntry: MealMemoryEntry?
}

struct PlannerChatRequest: Encodable {
    let message: String
    let state: JSONValue
    let addressId: String?
}

struct PlannerChatResponse: Codable {
    let status: String
    let state: JSONValue
    let reply: String
    let quickReplies: [String]?
    let recommendation: RecommendationRun?
}
