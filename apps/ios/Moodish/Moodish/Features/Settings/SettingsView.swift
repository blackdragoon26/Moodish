import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var isLoggingOut = false
    @State private var isClearingMemory = false
    @State private var statusMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                if let user = appState.user {
                    Section("Account") {
                        LabeledContent("Name", value: user.name)
                        if let email = user.email {
                            LabeledContent("Email", value: email)
                        }
                        LabeledContent("Signed in via", value: user.provider.capitalized)
                    }
                }

                Section("Appearance") {
                    Picker("Theme", selection: Bindable(appState.themeStore).theme) {
                        ForEach(AppTheme.allCases, id: \.self) { theme in
                            Text(theme.label).tag(theme)
                        }
                    }
                }

                if let health = appState.health {
                    Section("Connection") {
                        LabeledContent("Data mode", value: health.swiggyMode == "live" ? "Live Swiggy" : "Demo data")
                        LabeledContent("AI provider", value: health.aiProvider ?? "mock")
                        Text("Powered by Swiggy").font(.footnote).foregroundStyle(.secondary)
                    }
                }

                Section("Privacy") {
                    Button("Delete my taste memory") {
                        Task { await deleteTasteMemory() }
                    }
                    .disabled(isClearingMemory)
                }

                if let statusMessage {
                    Text(statusMessage).font(.footnote).foregroundStyle(.secondary)
                }

                Section {
                    Button("Log out", role: .destructive) {
                        Task { await logout() }
                    }
                    .disabled(isLoggingOut)
                }
            }
            .navigationTitle("Settings")
        }
    }

    private func logout() async {
        isLoggingOut = true
        defer { isLoggingOut = false }
        await appState.logout()
    }

    private func deleteTasteMemory() async {
        guard let userId = appState.user?.id else { return }
        isClearingMemory = true
        defer { isClearingMemory = false }
        do {
            try await appState.api.deleteTasteMemory(userIdHash: userId)
            statusMessage = "Taste memory cleared."
        } catch {
            statusMessage = error.localizedDescription
        }
    }
}
