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
    let foodCart: CartSummary?
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
