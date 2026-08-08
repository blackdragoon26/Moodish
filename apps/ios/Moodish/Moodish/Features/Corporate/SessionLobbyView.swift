import SwiftUI

struct SessionLobbyView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel: GroupSessionViewModel?
    let sessionId: String
    let initial: GroupSession?

    var body: some View {
        ScrollView {
            if let viewModel {
                VStack(alignment: .leading, spacing: 16) {
                    // The passcode is only ever returned once, at creation —
                    // later polls of `viewModel.session` won't carry it, so
                    // it's read from `initial` rather than the live session.
                    InviteCard(sessionId: sessionId, invitePasscode: initial?.invitePasscode)

                    if let session = viewModel.session {
                        StateBanner(state: session.state)

                        if session.state == .collecting {
                            Button("Simulate 3 teammates") {
                                Task { await viewModel.simulateTeammates() }
                            }
                            .buttonStyle(.bordered)

                            Button("Close responses & build plans") {
                                Task { await viewModel.lockAndRank() }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.moodishAccent)
                        }

                        if let submissions = session.submissions, !submissions.isEmpty {
                            ManagerReviewView(submissions: submissions)
                        }

                        if let options = session.options, !options.isEmpty {
                            OptionsList(
                                options: options,
                                approvalMode: session.approvalMode,
                                voteCounts: session.voteCounts,
                                selectedOptionId: session.selectedOptionId
                            ) { optionId in
                                Task { await viewModel.approve(optionId: optionId) }
                            }
                        }

                        if session.state == .awaitingCreatorConfirmation, let optionId = session.selectedOptionId {
                            Button("Creator: confirm final cart") {
                                Task { await viewModel.confirmCart() }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.moodishAccent)
                            .disabled(optionId.isEmpty)
                        }

                        if let cart = session.cart {
                            CartReviewView(result: cart) {}
                                .frame(height: 320)
                        }

                        if session.state.isActive {
                            Button("Cancel session", role: .destructive) {
                                Task { await viewModel.cancel() }
                            }
                        }
                    }

                    if let errorMessage = viewModel.errorMessage {
                        Text(errorMessage).foregroundStyle(.red).font(.footnote)
                    }
                }
                .padding()
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Group order")
        .task {
            if viewModel == nil {
                let model = GroupSessionViewModel(api: appState.api, sessionStore: appState.sessionStore, sessionId: sessionId, initial: initial)
                viewModel = model
                model.startPolling()
            }
        }
        .onDisappear { viewModel?.stopPolling() }
    }
}

private struct InviteCard: View {
    let sessionId: String
    let invitePasscode: String?

    private var shareText: String {
        if let invitePasscode {
            return "Join my Moodish group order: code \(sessionId), passcode \(invitePasscode)"
        }
        return "Join my Moodish group order: code \(sessionId)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Invite code").font(.caption).foregroundStyle(.secondary)
                    Text(sessionId).font(.system(.body, design: .monospaced))
                }
                Spacer()
                ShareLink(item: shareText) {
                    Image(systemName: "square.and.arrow.up")
                }
            }
            if let invitePasscode {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Passcode").font(.caption).foregroundStyle(.secondary)
                    Text(invitePasscode).font(.system(.body, design: .monospaced))
                }
            }
        }
        .padding()
        .background(Color.moodishSurface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

private struct StateBanner: View {
    let state: GroupSessionState

    var body: some View {
        Text(label)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Color.moodishAccent.opacity(0.15))
            .clipShape(Capsule())
    }

    private var label: String {
        switch state {
        case .collecting: return "Collecting responses"
        case .locked: return "Locked"
        case .ranking: return "Ranking options"
        case .voting: return "Team is voting"
        case .awaitingManager: return "Awaiting manager approval"
        case .awaitingCreatorConfirmation: return "Awaiting creator confirmation"
        case .cartBuilt: return "Cart built"
        case .cancelled: return "Cancelled"
        case .expired: return "Expired"
        case .unknown: return "Unknown"
        }
    }
}

private struct OptionsList: View {
    let options: [RecommendationOption]
    let approvalMode: GroupApprovalMode
    let voteCounts: [String: Int]?
    let selectedOptionId: String?
    let onApprove: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Options").font(.headline)
            ForEach(options) { option in
                HStack {
                    VStack(alignment: .leading) {
                        Text(option.restaurantName).font(.subheadline.weight(.medium))
                        Text("₹\(Int(option.estimatedTotal))").font(.caption).foregroundStyle(.secondary)
                        if let votes = voteCounts?[option.optionId] {
                            Text("\(votes) votes").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if approvalMode == .managerDecides {
                        Button(option.optionId == selectedOptionId ? "Approved" : "Approve this plan") {
                            onApprove(option.optionId)
                        }
                        .buttonStyle(.bordered)
                        .disabled(option.optionId == selectedOptionId)
                    }
                }
                .padding(10)
                .background(Color.moodishSurface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
    }
}
