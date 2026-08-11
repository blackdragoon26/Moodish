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
                    InviteCard(sessionId: sessionId, invitePasscode: initial?.invitePasscode, baseURL: appState.api.baseURL)

                    if let session = viewModel.session {
                        StateBanner(state: session.state)

                        ResponseProgressView(headcount: session.headcount, responseCount: session.responseCount ?? session.submissions?.count ?? 0)

                        if session.state == .collecting {
                            Button {
                                Task { await viewModel.simulateTeammates() }
                            } label: {
                                Label("Simulate 3 teammates (testing only)", systemImage: "wrench.and.screwdriver")
                                    .font(.footnote)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(.secondary)

                            Button("Close responses & build plans") {
                                Task { await viewModel.lockAndRank() }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.moodishAccent)
                        }

                        if let submissions = session.submissions, !submissions.isEmpty {
                            ManagerReviewView(submissions: submissions)
                        }

                        // The creator/manager's poll returns the full
                        // `recommendation.options` (with per-option coverage
                        // detail); other participants only see the stripped
                        // public `options`. Each option already tries to
                        // cover every teammate's request across restaurants
                        // and Instamart - it's not a single-restaurant menu
                        // to multi-select from.
                        if let options = session.recommendation?.options ?? session.options, !options.isEmpty {
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

private struct ResponseProgressView: View {
    let headcount: Int
    let responseCount: Int

    var body: some View {
        Text("\(responseCount) of \(headcount) teammates responded")
            .font(.footnote)
            .foregroundStyle(.secondary)
    }
}

private struct InviteCard: View {
    let sessionId: String
    let invitePasscode: String?
    let baseURL: URL

    /// Same invite link shape as the web app's own share button
    /// (`${location.origin}/?group=<sessionId>&action=preferences` - see
    /// apps/web/public/app.js) so recipients get a real tappable URL
    /// instead of bare text, on any device. Built from the app's own
    /// configured `baseURL` (not hardcoded to production) so the link
    /// actually resolves against whichever backend this build talks to.
    private var inviteURL: URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "group", value: sessionId),
            URLQueryItem(name: "action", value: "preferences"),
        ]
        return components.url!
    }

    /// Sent alongside the link rather than embedded in the URL, matching
    /// the web app's own choice not to put the passcode somewhere that
    /// could be logged or cached.
    private var shareMessage: Text? {
        invitePasscode.map { Text("Passcode: \($0)") }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Invite code").font(.caption).foregroundStyle(.secondary)
                    Text(sessionId).font(.system(.body, design: .monospaced))
                }
                Spacer()
                ShareLink(item: inviteURL, message: shareMessage) {
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
                        if let coverage = option.coverage {
                            Text("\(coverage.satisfiedCount) of \(coverage.totalParticipants) covered\(option.splitOrder == true ? " · split across restaurants" : "")")
                                .font(.caption2)
                                .foregroundStyle(coverage.compromiseCount > 0 ? .orange : .secondary)
                        }
                        if let votes = voteCounts?[option.optionId] {
                            Text("\(votes) votes").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    // Once any option has been approved, the backend's state
                    // machine no longer accepts a different selection - hide
                    // the other buttons entirely instead of leaving them
                    // tappable and surfacing a raw "Cannot select an option
                    // while session is awaiting_creator_confirmation" error.
                    if approvalMode == .managerDecides {
                        if let selectedOptionId {
                            if option.optionId == selectedOptionId {
                                Text("Approved").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            }
                        } else {
                            Button("Approve this plan") {
                                onApprove(option.optionId)
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                }
                .padding(10)
                .background(Color.moodishSurface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
    }
}
