import Foundation

struct AuthConfig: Codable, Equatable {
    let google: Bool
    let swiggy: Bool
    let swiggyAccessUrl: String
    let demo: Bool
}

struct MoodishUser: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let email: String?
    let picture: String?
    let provider: String
}

struct HealthStatus: Codable, Equatable {
    let ok: Bool
    let service: String?
    let swiggyMode: String?
    let aiProvider: String?
}

struct MealMemoryItem: Codable, Equatable {
    let name: String
    let quantity: Int?
}

struct MealMemoryAddOn: Codable, Equatable {
    let name: String
    let price: Double?
}

/// Shape returned in `bootstrap.mealMemory[]` and `cartConfirm.mealMemoryEntry`
/// (recommender.mjs) — items here are name+quantity only, not the full
/// `MealItem` shape used elsewhere, so this has its own lightweight item type.
struct MealMemoryEntry: Codable, Equatable, Identifiable {
    var id: String { (restaurantName ?? "meal") + (confirmedAt ?? UUID().uuidString) }
    let recommendationId: String?
    let restaurantName: String?
    let cuisine: String?
    let items: [MealMemoryItem]?
    let addOns: [MealMemoryAddOn]?
    let foodTotal: Double?
    let instamartTotal: Double?
    let confirmedAt: String?

    var total: Double? {
        guard foodTotal != nil || instamartTotal != nil else { return nil }
        return (foodTotal ?? 0) + (instamartTotal ?? 0)
    }
}

struct BootstrapResponse: Codable {
    let config: AuthConfig
    let user: MoodishUser?
    let mealMemory: [MealMemoryEntry]
    let health: HealthStatus
}

struct AuthMeResponse: Codable {
    let user: MoodishUser?
}

struct DemoLoginResponse: Codable {
    let user: MoodishUser
}
