import Foundation

struct ChatMessage: Identifiable, Equatable {
    enum Role { case user, assistant, error }
    let id = UUID()
    let role: Role
    let text: String
}

@Observable
@MainActor
final class ChatViewModel {
    private let api: APIClient

    var messages: [ChatMessage] = []
    var quickReplies: [String] = []
    /// The most recent recommendation, retained even after the deck sheet is
    /// dismissed so the user can reopen it (e.g. via a "View recommendation"
    /// button) instead of being stuck until a brand-new chat turn produces one.
    var lastRecommendation: RecommendationRun?
    var isSending = false
    private var state: JSONValue = .object([:])

    init(api: APIClient) {
        self.api = api
    }

    func send(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSending else { return }
        messages.append(ChatMessage(role: .user, text: trimmed))
        quickReplies = []
        isSending = true
        defer { isSending = false }
        do {
            let response = try await api.plannerChat(message: trimmed, state: state)
            state = response.state
            messages.append(ChatMessage(role: .assistant, text: response.reply))
            quickReplies = response.quickReplies ?? []
            if let recommendation = response.recommendation {
                self.lastRecommendation = recommendation
            }
        } catch {
            messages.append(ChatMessage(role: .error, text: error.localizedDescription))
        }
    }
}
