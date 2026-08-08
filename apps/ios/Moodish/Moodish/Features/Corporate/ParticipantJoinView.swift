import SwiftUI

struct ParticipantJoinView: View {
    @Environment(AppState.self) private var appState

    @State private var sessionId = ""
    @State private var passcode = ""
    @State private var joinedSessionId: String?
    @State private var errorMessage: String?
    @State private var isJoining = false

    var body: some View {
        Form {
            Section("Session") {
                TextField("Invite code", text: $sessionId)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Passcode (if required)", text: $passcode)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }

            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red).font(.footnote)
            }

            Section {
                Button {
                    Task { await join() }
                } label: {
                    if isJoining { ProgressView() } else { Text("Join") }
                }
                .disabled(sessionId.isEmpty || isJoining)
            }
        }
        .navigationTitle("Join group order")
        .navigationDestination(item: $joinedSessionId) { sessionId in
            ParticipantPreferenceView(sessionId: sessionId, invitePasscode: passcode.isEmpty ? nil : passcode)
        }
    }

    private func join() async {
        isJoining = true
        errorMessage = nil
        defer { isJoining = false }
        do {
            if passcode.isEmpty {
                _ = try await appState.api.getGroupSession(sessionId: sessionId, bearerToken: nil)
            } else {
                _ = try await appState.api.accessGroupSession(sessionId: sessionId, invitePasscode: passcode)
            }
            joinedSessionId = sessionId
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct ParticipantPreferenceView: View {
    @Environment(AppState.self) private var appState
    let sessionId: String
    let invitePasscode: String?

    @State private var mood = ""
    @State private var dietMode = "veg"
    @State private var allergies = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var session: GroupSession?
    @State private var participantId = ""

    private let dietOptions = ["veg", "non_veg", "vegan"]

    var body: some View {
        Group {
            if let session, session.state == .voting {
                VotingView(sessionId: sessionId, participantId: participantId, invitePasscode: invitePasscode, session: session)
            } else if let session, !session.state.isActive {
                TerminalStateView(state: session.state)
            } else {
                Form {
                    Section("Your preference") {
                        Picker("Diet", selection: $dietMode) {
                            ForEach(dietOptions, id: \.self) { Text($0.replacingOccurrences(of: "_", with: " ").capitalized) }
                        }
                        TextField("Mood / craving", text: $mood)
                        TextField("Allergies (optional)", text: $allergies)
                    }
                    if let errorMessage {
                        Text(errorMessage).foregroundStyle(.red).font(.footnote)
                    }
                    Section {
                        Button {
                            Task { await submit() }
                        } label: {
                            if isSubmitting { ProgressView() } else { Text("Submit preference") }
                        }
                        .disabled(mood.isEmpty || isSubmitting)
                    }
                }
            }
        }
        .navigationTitle("Your lunch")
        .onAppear {
            participantId = appState.sessionStore.participantId(sessionId: sessionId) ?? {
                let id = "participant-\(UUID().uuidString.prefix(8))"
                appState.sessionStore.setParticipantId(id, sessionId: sessionId)
                return id
            }()
        }
    }

    private func submit() async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            session = try await appState.api.submitPreferences(
                sessionId: sessionId,
                participantId: participantId,
                dietMode: dietMode,
                mood: mood,
                dietaryRules: nil,
                allergies: allergies.isEmpty ? nil : allergies,
                invitePasscode: invitePasscode,
                bearerToken: nil
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct TerminalStateView: View {
    let state: GroupSessionState

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.largeTitle).foregroundStyle(.secondary)
            Text(message).multilineTextAlignment(.center).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private var icon: String {
        switch state {
        case .cartBuilt: return "bag.fill.badge.plus"
        case .cancelled, .expired: return "xmark.circle"
        default: return "hourglass"
        }
    }

    private var message: String {
        switch state {
        case .locked: return "Responses are locked. Moodish is preparing options."
        case .ranking: return "Ranking the best options for the team."
        case .awaitingManager: return "Waiting for the manager to approve a plan."
        case .awaitingCreatorConfirmation: return "Waiting for the creator to confirm the final cart."
        case .cartBuilt: return "The cart is confirmed. Enjoy your meal!"
        case .cancelled: return "This session was cancelled."
        case .expired: return "This session has expired."
        default: return "Please check back shortly."
        }
    }
}
