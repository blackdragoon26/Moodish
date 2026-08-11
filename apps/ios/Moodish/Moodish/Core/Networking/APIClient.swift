import Foundation

/// Thin REST client for the Moodish agent service. Mirrors the routes the
/// web app (`apps/web/public/app.js`) calls — see docs/architecture.md and
/// services/agent/src/server.mjs for the source of truth.
final class APIClient {
    let baseURL: URL
    private let session: URLSession
    private let sessionStore: SessionStore
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(sessionStore: SessionStore) {
        self.sessionStore = sessionStore
        let configured = Bundle.main.object(forInfoDictionaryKey: "MoodishAPIBaseURL") as? String
        self.baseURL = URL(string: configured?.isEmpty == false ? configured! : "https://moodish.onrender.com")!
        let configuration = URLSessionConfiguration.default
        configuration.httpShouldSetCookies = true
        configuration.httpCookieAcceptPolicy = .always
        configuration.httpCookieStorage = .shared
        self.session = URLSession(configuration: configuration)
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    // MARK: - Core request

    /// `bearerToken` is an explicit override (used for the group-session
    /// bearer scheme, which is a *different* signed token than the personal
    /// session — see access-token.mjs vs auth.mjs on the backend). When
    /// `usePersonalSession` is true and no override is given, the personal
    /// session token is attached automatically; group-session calls always
    /// pass `usePersonalSession: false` so an anonymous participant call
    /// never accidentally carries the logged-in user's unrelated token
    /// (which would fail the group token's signature check and 401).
    private func send<Response: Decodable>(
        _ path: String,
        method: String = "GET",
        body: Encodable? = nil,
        bearerToken: String? = nil,
        usePersonalSession: Bool = true
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        let token = bearerToken ?? (usePersonalSession ? sessionStore.sessionToken : nil)
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        }
        if let body {
            request.httpBody = try encoder.encode(AnyEncodable(body))
        } else if method == "POST" {
            request.httpBody = Data("{}".utf8)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport(URLError(.badServerResponse))
        }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 { throw APIError.unauthorized }
            let message = (try? decoder.decode(APIErrorBody.self, from: data))?.error ?? "Request failed (\(http.statusCode))"
            throw APIError.server(status: http.statusCode, message: message)
        }
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    // MARK: - Bootstrap & auth

    func bootstrap() async throws -> BootstrapResponse {
        try await send("/api/bootstrap")
    }

    func authConfig() async throws -> AuthConfig {
        try await send("/api/auth/config")
    }

    func demoLogin() async throws -> DemoLoginResponse {
        try await send("/api/auth/demo", method: "POST")
    }

    func logout() async throws {
        let _: EmptyResponse = try await send("/api/auth/logout", method: "POST")
    }

    var googleMobileAuthorizeURL: URL {
        var components = URLComponents(url: baseURL.appendingPathComponent("/api/auth/google/start"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "client", value: "mobile")]
        return components.url!
    }

    // MARK: - Personal flow

    func personalRecommendations(budget: Double, mood: String, dietaryRules: String?) async throws -> RecommendationRun {
        struct Body: Encodable { let budget: Double; let mood: String; let dietaryRules: String? }
        return try await send("/api/recommendations/personal", method: "POST", body: Body(budget: budget, mood: mood, dietaryRules: dietaryRules))
    }

    func plannerChat(message: String, state: JSONValue, addressId: String? = nil) async throws -> PlannerChatResponse {
        let body = PlannerChatRequest(message: message, state: state, addressId: addressId)
        return try await send("/api/planner/chat", method: "POST", body: body)
    }

    func confirmCart(recommendationId: String, optionId: String, addOnProductIds: [String]) async throws -> CartConfirmResult {
        struct Body: Encodable {
            let recommendationId: String
            let optionId: String
            let addOnProductIds: [String]
            let confirmed = true
        }
        return try await send("/api/cart/confirm", method: "POST", body: Body(recommendationId: recommendationId, optionId: optionId, addOnProductIds: addOnProductIds))
    }

    func sendFeedback(recommendationId: String, rating: Int, tags: [String], notes: String?) async throws {
        struct Body: Encodable {
            let recommendationId: String
            let rating: Int
            let tags: [String]
            let notes: String?
        }
        let _: EmptyResponse = try await send("/api/feedback", method: "POST", body: Body(recommendationId: recommendationId, rating: rating, tags: tags, notes: notes))
    }

    // MARK: - Corporate / group flow

    func createGroupSession(creatorId: String, headcount: Int, budgetPerPerson: Double, approvalMode: GroupApprovalMode, vibe: String?) async throws -> GroupSession {
        let body = CreateGroupSessionRequest(creatorId: creatorId, headcount: headcount, budgetPerPerson: budgetPerPerson, approvalMode: approvalMode.rawValue, vibe: vibe)
        return try await send("/api/group-sessions", method: "POST", body: body, usePersonalSession: false)
    }

    func getGroupSession(sessionId: String, bearerToken: String?) async throws -> GroupSession {
        try await send("/api/group-sessions/\(sessionId)", bearerToken: bearerToken, usePersonalSession: false)
    }

    func accessGroupSession(sessionId: String, invitePasscode: String) async throws -> GroupSession {
        struct Body: Encodable { let invitePasscode: String }
        return try await send("/api/group-sessions/\(sessionId)/access", method: "POST", body: Body(invitePasscode: invitePasscode), usePersonalSession: false)
    }

    func submitPreferences(sessionId: String, participantId: String, dietMode: String, mood: String, dietaryRules: String?, allergies: String?, invitePasscode: String?, bearerToken: String?) async throws -> GroupSession {
        struct Body: Encodable {
            let participantId: String
            let dietMode: String
            let mood: String
            let dietaryRules: String?
            let allergies: String?
            let invitePasscode: String?
        }
        return try await send("/api/group-sessions/\(sessionId)/preferences", method: "POST", body: Body(participantId: participantId, dietMode: dietMode, mood: mood, dietaryRules: dietaryRules, allergies: allergies, invitePasscode: invitePasscode), bearerToken: bearerToken, usePersonalSession: false)
    }

    func rankGroupSession(sessionId: String, bearerToken: String) async throws -> GroupSession {
        try await send("/api/group-sessions/\(sessionId)/rank", method: "POST", bearerToken: bearerToken, usePersonalSession: false)
    }

    func voteGroupSession(sessionId: String, participantId: String, optionId: String, invitePasscode: String?, bearerToken: String?) async throws -> GroupSession {
        struct Body: Encodable { let participantId: String; let optionId: String; let invitePasscode: String? }
        return try await send("/api/group-sessions/\(sessionId)/vote", method: "POST", body: Body(participantId: participantId, optionId: optionId, invitePasscode: invitePasscode), bearerToken: bearerToken, usePersonalSession: false)
    }

    func selectGroupOption(sessionId: String, optionId: String, bearerToken: String) async throws -> GroupSession {
        struct Body: Encodable { let optionId: String }
        return try await send("/api/group-sessions/\(sessionId)/select", method: "POST", body: Body(optionId: optionId), bearerToken: bearerToken, usePersonalSession: false)
    }

    func confirmGroupCart(sessionId: String, addOnProductIds: [String], bearerToken: String) async throws -> GroupSession {
        struct Body: Encodable { let addOnProductIds: [String]; let confirmed = true }
        return try await send("/api/group-sessions/\(sessionId)/confirm-cart", method: "POST", body: Body(addOnProductIds: addOnProductIds), bearerToken: bearerToken, usePersonalSession: false)
    }

    func cancelGroupSession(sessionId: String, bearerToken: String) async throws -> GroupSession {
        try await send("/api/group-sessions/\(sessionId)/cancel", method: "POST", bearerToken: bearerToken, usePersonalSession: false)
    }

    // MARK: - Privacy

    func deleteTasteMemory(userIdHash: String) async throws {
        struct Body: Encodable { let userIdHash: String }
        let _: EmptyResponse = try await send("/api/privacy/delete-taste-memory", method: "POST", body: Body(userIdHash: userIdHash))
    }
}

struct EmptyResponse: Decodable {}

/// Type-erasing wrapper so `send` can accept an `Encodable` existential.
private struct AnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void
    init(_ wrapped: Encodable) {
        encodeClosure = wrapped.encode
    }
    func encode(to encoder: Encoder) throws {
        try encodeClosure(encoder)
    }
}
