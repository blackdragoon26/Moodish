import SwiftUI

struct CreateSessionView: View {
    @Environment(AppState.self) private var appState

    @State private var headcount = 6
    @State private var budgetPerPerson: Double = 250
    @State private var approvalMode: GroupApprovalMode = .managerDecides
    @State private var vibe = ""
    @State private var isCreating = false
    @State private var errorMessage: String?
    @State private var createdSession: GroupSession?

    var body: some View {
        Form {
            Section("Headcount & budget") {
                Stepper("Headcount: \(headcount)", value: $headcount, in: 2...50)
                VStack(alignment: .leading) {
                    Text("Budget per person: ₹\(Int(budgetPerPerson))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Slider(value: $budgetPerPerson, in: 100...1000, step: 10)
                }
            }

            Section("Approval") {
                Picker("Approval mode", selection: $approvalMode) {
                    ForEach(GroupApprovalMode.allCases) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }
            }

            Section("Vibe (optional)") {
                TextField("e.g. celebratory, quick weekday lunch", text: $vibe)
            }

            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red).font(.footnote)
            }

            Section {
                Button {
                    Task { await createSession() }
                } label: {
                    if isCreating { ProgressView() } else { Text("Create session") }
                }
                .disabled(isCreating)
            }
        }
        .navigationTitle("New group order")
        .navigationDestination(item: Binding(get: { createdSession?.sessionId }, set: { _ in createdSession = nil })) { sessionId in
            SessionLobbyView(sessionId: sessionId, initial: createdSession)
        }
    }

    private func createSession() async {
        isCreating = true
        errorMessage = nil
        defer { isCreating = false }
        do {
            let creatorId = appState.user?.id ?? "manager-\(UUID().uuidString.prefix(8))"
            let session = try await appState.api.createGroupSession(
                creatorId: creatorId,
                headcount: headcount,
                budgetPerPerson: budgetPerPerson,
                approvalMode: approvalMode,
                vibe: vibe.isEmpty ? nil : vibe
            )
            if let token = session.accessToken {
                appState.sessionStore.setGroupAccessToken(token, sessionId: session.sessionId)
            }
            createdSession = session
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
