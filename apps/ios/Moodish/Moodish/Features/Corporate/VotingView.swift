import SwiftUI

struct VotingView: View {
    @Environment(AppState.self) private var appState
    let sessionId: String
    let participantId: String
    let invitePasscode: String?
    @State var session: GroupSession

    @State private var selectedOptionId: String?
    @State private var isVoting = false
    @State private var errorMessage: String?
    @State private var pollTask: Task<Void, Never>?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Vote for the team's lunch").font(.headline)
                ForEach(session.options ?? []) { option in
                    Button {
                        selectedOptionId = option.optionId
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(option.restaurantName).font(.subheadline.weight(.medium))
                                Text("₹\(Int(option.estimatedTotal))").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if option.optionId == selectedOptionId {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(.moodishAccent)
                            }
                        }
                        .padding()
                        .background(Color.moodishSurface)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                }

                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red).font(.footnote)
                }

                Button {
                    Task { await vote() }
                } label: {
                    if isVoting { ProgressView() } else { Text("Vote selected") }
                }
                .buttonStyle(.borderedProminent)
                .tint(.moodishAccent)
                .disabled(selectedOptionId == nil || isVoting)
                .frame(maxWidth: .infinity)
            }
            .padding()
        }
        .task { startPolling() }
        .onDisappear { pollTask?.cancel() }
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task {
            while !Task.isCancelled, session.state.isActive {
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                if let refreshed = try? await appState.api.getGroupSession(sessionId: sessionId, bearerToken: nil) {
                    session = refreshed
                }
            }
        }
    }

    private func vote() async {
        guard let selectedOptionId else { return }
        isVoting = true
        errorMessage = nil
        defer { isVoting = false }
        do {
            session = try await appState.api.voteGroupSession(
                sessionId: sessionId,
                participantId: participantId,
                optionId: selectedOptionId,
                invitePasscode: invitePasscode,
                bearerToken: nil
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
