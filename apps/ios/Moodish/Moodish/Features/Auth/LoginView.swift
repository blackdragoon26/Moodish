import SwiftUI

struct LoginView: View {
    @Environment(AppState.self) private var appState
    @State private var googleAuthSession = GoogleAuthSession()
    @State private var isSigningIn = false
    @State private var errorMessage: String?

    private var config: AuthConfig? { appState.authConfig }

    var body: some View {
        VStack(spacing: 28) {
            Spacer()

            HStack(spacing: 10) {
                Image("MoodishLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 42, height: 42)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                Text("Moodish")
                    .font(.title2.weight(.heavy))
            }

            VStack(spacing: 8) {
                Text("YOUR FOOD CONCIERGE")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.moodishAccent)
                    .tracking(1.2)
                Text("Say the mood.\nWe'll find the meal.")
                    .font(.system(.largeTitle, design: .serif))
                    .multilineTextAlignment(.center)
            }

            if let health = appState.health {
                DataModeBadge(swiggyMode: health.swiggyMode)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            VStack(spacing: 12) {
                Button {
                    Task { await signInWithGoogle() }
                } label: {
                    LoginButtonLabel(title: "Continue with Google", systemImage: "g.circle.fill")
                }
                .disabled(config?.google != true || isSigningIn)
                .opacity(config?.google == true ? 1 : 0.5)

                if config?.google == false {
                    Text("Google login isn't configured on this deployment yet.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                if let config, config.swiggy == false, let url = URL(string: config.swiggyAccessUrl) {
                    Link(destination: url) {
                        LoginButtonLabel(title: "Swiggy access pending", systemImage: "s.circle.fill")
                    }
                    .opacity(0.6)
                }

                if config?.demo == true {
                    Button {
                        Task { await signInWithDemo() }
                    } label: {
                        LoginButtonLabel(title: "Preview with demo access", systemImage: "sparkles")
                    }
                    .disabled(isSigningIn)
                }
            }
            .padding(.horizontal, 24)

            Spacer()
            ThemePicker()
                .padding(.bottom, 24)
        }
        .background(Color.moodishBackground)
    }

    private func signInWithDemo() async {
        errorMessage = nil
        isSigningIn = true
        defer { isSigningIn = false }
        do {
            try await appState.loginWithDemo()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func signInWithGoogle() async {
        errorMessage = nil
        isSigningIn = true
        defer { isSigningIn = false }
        do {
            let token = try await googleAuthSession.signIn(authorizeURL: appState.api.googleMobileAuthorizeURL)
            appState.loginWithGoogleToken(token)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct LoginButtonLabel: View {
    let title: String
    let systemImage: String

    var body: some View {
        HStack {
            Image(systemName: systemImage)
            Text(title)
            Spacer()
        }
        .padding()
        .background(Color.moodishSurface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

private struct DataModeBadge: View {
    let swiggyMode: String?

    var body: some View {
        Text(swiggyMode == "live" ? "Live Swiggy" : "Demo data")
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Color.moodishSurface)
            .clipShape(Capsule())
    }
}

private struct ThemePicker: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        Picker("Theme", selection: Bindable(appState.themeStore).theme) {
            ForEach(AppTheme.allCases, id: \.self) { theme in
                Text(theme.label).tag(theme)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 24)
    }
}
