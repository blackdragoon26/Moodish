import Foundation

/// Drives a group session after creation: polls every 2.5s while the
/// session is active, matching the web app's manager polling loop
/// (app.js), and exposes the state-machine-gated manager actions.
@Observable
@MainActor
final class GroupSessionViewModel {
    private let api: APIClient
    private let sessionStore: SessionStore
    let sessionId: String

    var session: GroupSession?
    var errorMessage: String?
    var isBusy = false
    private var pollTask: Task<Void, Never>?

    private var accessToken: String? {
        sessionStore.groupAccessToken(sessionId: sessionId)
    }

    init(api: APIClient, sessionStore: SessionStore, sessionId: String, initial: GroupSession? = nil) {
        self.api = api
        self.sessionStore = sessionStore
        self.sessionId = sessionId
        self.session = initial
    }

    func startPolling() {
        stopPolling()
        pollTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                await self.refresh()
                guard let state = self.session?.state, state.isActive else { break }
                try? await Task.sleep(nanoseconds: 2_500_000_000)
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    func refresh() async {
        do {
            session = try await api.getGroupSession(sessionId: sessionId, bearerToken: accessToken)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func simulateTeammates() async {
        let fixtures: [(mood: String, dietMode: String)] = [
            ("comfort food", "veg"),
            ("something light", "non_veg"),
            ("spicy and exciting", "veg")
        ]
        for (index, fixture) in fixtures.enumerated() {
            do {
                session = try await api.submitPreferences(
                    sessionId: sessionId,
                    participantId: "demo-teammate-\(index + 1)",
                    dietMode: fixture.dietMode,
                    mood: fixture.mood,
                    dietaryRules: nil,
                    allergies: nil,
                    invitePasscode: nil,
                    bearerToken: accessToken
                )
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func lockAndRank() async {
        guard let accessToken else { return }
        await run { try await api.rankGroupSession(sessionId: sessionId, bearerToken: accessToken) }
    }

    func approve(optionId: String) async {
        guard let accessToken else { return }
        await run { try await api.selectGroupOption(sessionId: sessionId, optionId: optionId, bearerToken: accessToken) }
    }

    func confirmCart(addOnProductIds: [String] = []) async {
        guard let accessToken else { return }
        await run { try await api.confirmGroupCart(sessionId: sessionId, addOnProductIds: addOnProductIds, bearerToken: accessToken) }
    }

    func cancel() async {
        guard let accessToken else { return }
        await run { try await api.cancelGroupSession(sessionId: sessionId, bearerToken: accessToken) }
    }

    private func run(_ operation: () async throws -> GroupSession) async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            session = try await operation()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
