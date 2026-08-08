import Foundation

enum BootstrapPhase: Equatable {
    case connecting(attempt: Int)
    case ready
    case failed(String)
}

/// Root app state: who's logged in, server config, and the slow-reconnect
/// dance the web app does against a Render cold start (see app.js `boot()`).
@Observable
@MainActor
final class AppState {
    let sessionStore = SessionStore()
    let themeStore = ThemeStore()
    let api: APIClient

    var phase: BootstrapPhase = .connecting(attempt: 1)
    var authConfig: AuthConfig?
    var user: MoodishUser?
    var mealMemory: [MealMemoryEntry] = []
    var health: HealthStatus?

    var isLoggedIn: Bool { user != nil }

    init() {
        api = APIClient(sessionStore: sessionStore)
    }

    func bootstrap() async {
        let maxAttempts = 6
        var attempt = 1
        while attempt <= maxAttempts {
            phase = .connecting(attempt: attempt)
            do {
                let result = try await api.bootstrap()
                authConfig = result.config
                user = result.user
                mealMemory = result.mealMemory
                health = result.health
                phase = .ready
                return
            } catch {
                if attempt == maxAttempts {
                    phase = .failed("Moodish is taking longer than usual to wake up. Pull to retry.")
                    return
                }
                let delayMs = min(5000, 300 * (1 << attempt))
                try? await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
                attempt += 1
            }
        }
    }

    func loginWithDemo() async throws {
        let response = try await api.demoLogin()
        user = response.user
    }

    func loginWithGoogleToken(_ token: String) {
        sessionStore.setSessionToken(token)
        Task { await bootstrap() }
    }

    func logout() async {
        try? await api.logout()
        sessionStore.logout()
        user = nil
        mealMemory = []
    }
}
