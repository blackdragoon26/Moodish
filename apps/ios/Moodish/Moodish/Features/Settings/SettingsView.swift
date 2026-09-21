import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var isLoggingOut = false
    @State private var isClearingMemory = false
    @State private var swiggyAuth = GoogleAuthSession()
    @State private var connection: SwiggyConnection?
    @State private var addresses: [SwiggyAddress] = []
    @State private var selectedAddress = ""
    @State private var isConnecting = false
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

                if appState.health?.swiggyMode == "live" {
                    Section("Swiggy") {
                        Text(connection?.connected == true ? "Connected" : "Connect Swiggy to discover meals")
                        Button("Connect / reconnect Swiggy") { Task { await connect() } }.disabled(isConnecting)
                        if connection?.connected == true {
                            Picker("Delivery address", selection: $selectedAddress) {
                                Text("Choose an address").tag("")
                                ForEach(addresses) { a in Text("\(a.label) · \(a.display)").tag(a.id) }
                            }.onChange(of: selectedAddress) { _, value in
                                guard !value.isEmpty else { return }
                                Task { do { try await appState.api.selectAddress(value) } catch { statusMessage = error.localizedDescription } }
                            }
                            Button("Disconnect Swiggy") { Task { do { try await appState.api.disconnectSwiggy(); await loadSwiggy() } catch { statusMessage = error.localizedDescription } } }
                        }
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
            .task { await loadSwiggy() }
        }
    }

    private func loadSwiggy() async {
        guard appState.health?.swiggyMode == "live" else { return }
        do {
            connection = try await appState.api.swiggyConnection()
            if connection?.connected == true { addresses = try await appState.api.swiggyAddresses().addresses }
            selectedAddress = connection?.selectedAddressId ?? ""
        } catch { statusMessage = error.localizedDescription }
    }
    private func connect() async {
        isConnecting = true
        defer { isConnecting = false }
        do {
            let token = try await swiggyAuth.connectSwiggy(api: appState.api)
            appState.sessionStore.setSessionToken(token)
            await loadSwiggy()
        } catch { statusMessage = error.localizedDescription }
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
