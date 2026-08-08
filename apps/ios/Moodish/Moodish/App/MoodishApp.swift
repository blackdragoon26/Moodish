import SwiftUI

@main
struct MoodishApp: App {
    @State private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .preferredColorScheme(appState.themeStore.theme.colorScheme)
        }
    }
}

struct RootView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        Group {
            switch appState.phase {
            case .connecting(let attempt):
                ConnectingView(attempt: attempt)
            case .failed(let message):
                BootstrapFailedView(message: message)
            case .ready:
                if appState.isLoggedIn {
                    HomeView()
                } else {
                    LoginView()
                }
            }
        }
        .task {
            if case .connecting = appState.phase {
                await appState.bootstrap()
            }
        }
    }
}

private struct ConnectingView: View {
    let attempt: Int

    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text(attempt <= 2 ? "Moodish is waking up…" : "Reconnecting automatically…")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.moodishBackground)
    }
}

private struct BootstrapFailedView: View {
    @Environment(AppState.self) private var appState
    let message: String

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text(message)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 32)
            Button("Retry") {
                Task { await appState.bootstrap() }
            }
            .buttonStyle(.borderedProminent)
            .tint(.moodishAccent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.moodishBackground)
    }
}
