import SwiftUI

struct ChatView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel: ChatViewModel?
    @State private var draft = ""
    @State private var showMealDial = false
    @State private var showMealMemory = false
    @State private var showRecommendationSheet = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let viewModel {
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 12) {
                                if viewModel.messages.isEmpty {
                                    EmptyChatPrompt()
                                }
                                ForEach(viewModel.messages) { message in
                                    ChatBubble(message: message)
                                        .id(message.id)
                                }
                                if viewModel.isSending {
                                    TypingIndicator()
                                }
                            }
                            .padding()
                        }
                        .onChange(of: viewModel.messages) { _, _ in
                            if let last = viewModel.messages.last {
                                withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                            }
                        }
                    }

                    if !viewModel.quickReplies.isEmpty {
                        QuickReplyRow(replies: viewModel.quickReplies) { reply in
                            Task { await viewModel.send(reply) }
                        }
                    }

                    if showMealDial {
                        MealDialView { summary in
                            Task { await viewModel.send(summary) }
                            showMealDial = false
                        }
                        .transition(.move(edge: .bottom))
                    }

                    ChatInputBar(text: $draft, showMealDial: $showMealDial) {
                        let text = draft
                        draft = ""
                        Task { await viewModel.send(text) }
                    }
                }
            }
            .navigationTitle("Moodish")
            .toolbar {
                if viewModel?.lastRecommendation != nil {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { showRecommendationSheet = true } label: {
                            Label("Recommendation", systemImage: "bag.fill")
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showMealMemory = true } label: {
                        Image(systemName: "clock.arrow.circlepath")
                    }
                }
            }
            .onChange(of: viewModel?.lastRecommendation?.recommendationId) { _, newId in
                if newId != nil { showRecommendationSheet = true }
            }
            .sheet(isPresented: $showRecommendationSheet) {
                if let recommendation = viewModel?.lastRecommendation {
                    RecommendationDeckView(recommendation: recommendation) {
                        showRecommendationSheet = false
                    }
                }
            }
            .sheet(isPresented: $showMealMemory) {
                MealMemoryView(entries: appState.mealMemory)
                    .presentationDetents([.medium])
            }
        }
        .task {
            if viewModel == nil {
                viewModel = ChatViewModel(api: appState.api)
            }
        }
    }
}

extension RecommendationRun: Identifiable {
    var id: String { recommendationId }
}

private struct EmptyChatPrompt: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("What are you in the mood for?")
                .font(.headline)
            Text("Tell me a craving, a budget, or just how you're feeling — I'll find the meal.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 24)
    }
}

private struct ChatBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 40) }
            Text(message.text)
                .padding(12)
                .background(background)
                .foregroundStyle(message.role == .error ? Color.red : Color.primary)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            if message.role != .user { Spacer(minLength: 40) }
        }
    }

    private var background: Color {
        switch message.role {
        case .user: return .moodishAccent.opacity(0.85)
        case .assistant: return .moodishSurface
        case .error: return .red.opacity(0.12)
        }
    }
}

private struct TypingIndicator: View {
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { _ in
                Circle().frame(width: 6, height: 6)
            }
        }
        .foregroundStyle(.secondary)
        .padding(12)
        .background(Color.moodishSurface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct QuickReplyRow: View {
    let replies: [String]
    let onTap: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                ForEach(replies, id: \.self) { reply in
                    Button(reply) { onTap(reply) }
                        .buttonStyle(.bordered)
                }
            }
            .padding(.horizontal)
        }
        .padding(.vertical, 8)
    }
}

private struct ChatInputBar: View {
    @Binding var text: String
    @Binding var showMealDial: Bool
    let onSend: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button {
                withAnimation { showMealDial.toggle() }
            } label: {
                Image(systemName: "slider.horizontal.3")
            }

            TextField("Say the mood…", text: $text, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .onSubmit(onSend)

            Button(action: onSend) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
            }
            .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding()
        .background(.thinMaterial)
    }
}
