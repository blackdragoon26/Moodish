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
    var recommendation: RecommendationRun?
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
                self.recommendation = recommendation
            }
        } catch {
            messages.append(ChatMessage(role: .error, text: error.localizedDescription))
        }
    }

    func dismissRecommendation() {
        recommendation = nil
    }
}
