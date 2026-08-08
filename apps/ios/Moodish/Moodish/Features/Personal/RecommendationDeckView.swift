import SwiftUI

struct RecommendationDeckView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    let recommendation: RecommendationRun
    let onDone: () -> Void

    @State private var selectedOptionId: String?
    @State private var selectedAddOnIds: Set<String> = []
    @State private var showCartConfirmation = false
    @State private var cartResult: CartConfirmResult?
    @State private var errorMessage: String?
    @State private var isConfirming = false

    private var selectedOption: RecommendationOption? {
        recommendation.options.first { $0.optionId == selectedOptionId }
    }

    private var runningTotal: Double {
        let optionTotal = selectedOption?.estimatedTotal ?? 0
        let addOnTotal = recommendation.addOns
            .filter { selectedAddOnIds.contains($0.productId) }
            .reduce(0) { $0 + $1.price }
        return optionTotal + addOnTotal
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let summary = recommendation.summary {
                        Text(summary)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    if let demo = recommendation.demo, demo.active {
                        Text(demo.note ?? "Demo data — no live Swiggy order will be placed.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    ForEach(recommendation.options) { option in
                        OptionCard(option: option, isSelected: option.optionId == selectedOptionId) {
                            selectedOptionId = option.optionId
                        }
                    }

                    if !recommendation.addOns.isEmpty {
                        Text("Moodish Pairings")
                            .font(.headline)
                        ForEach(recommendation.addOns) { addOn in
                            AddOnRow(addOn: addOn, isSelected: selectedAddOnIds.contains(addOn.productId)) {
                                if selectedAddOnIds.contains(addOn.productId) {
                                    selectedAddOnIds.remove(addOn.productId)
                                } else {
                                    selectedAddOnIds.insert(addOn.productId)
                                }
                            }
                        }
                    }

                    if let errorMessage {
                        Text(errorMessage).font(.footnote).foregroundStyle(.red)
                    }
                }
                .padding()
            }
            .safeAreaInset(edge: .bottom) {
                CartReviewBar(
                    total: runningTotal,
                    isEnabled: selectedOptionId != nil,
                    isBusy: isConfirming
                ) {
                    showCartConfirmation = true
                }
            }
            .navigationTitle("Recommendations")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { onDone(); dismiss() }
                }
            }
            .confirmationDialog(
                "Prepare the selected Food and Instamart cart previews? This still will not place an order.",
                isPresented: $showCartConfirmation,
                titleVisibility: .visible
            ) {
                Button("Confirm preview") { Task { await confirmCart() } }
                Button("Cancel", role: .cancel) {}
            }
            .sheet(item: $cartResult) { result in
                CartReviewView(result: result) {
                    cartResult = nil
                    onDone()
                    dismiss()
                }
            }
        }
    }

    private func confirmCart() async {
        guard let selectedOptionId else { return }
        isConfirming = true
        errorMessage = nil
        defer { isConfirming = false }
        do {
            cartResult = try await appState.api.confirmCart(
                recommendationId: recommendation.recommendationId,
                optionId: selectedOptionId,
                addOnProductIds: Array(selectedAddOnIds)
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

extension CartConfirmResult: Identifiable {
    var id: String { recommendationId ?? UUID().uuidString }
}

private struct OptionCard: View {
    let option: RecommendationOption
    let isSelected: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(option.restaurantName).font(.headline)
                    Spacer()
                    Text("₹\(Int(option.estimatedTotal))").font(.headline)
                }
                if let cuisine = option.cuisine {
                    Text(cuisine).font(.caption).foregroundStyle(.secondary)
                }
                ForEach(option.items) { item in
                    Text("• \(item.name)").font(.caption)
                }
                if let reasons = option.reasons, let first = reasons.first {
                    Text(first).font(.caption2).foregroundStyle(.moodishAccent)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(isSelected ? Color.moodishAccent.opacity(0.15) : Color.moodishSurface)
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(isSelected ? Color.moodishAccent : .clear, lineWidth: 2)
            )
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }
}

private struct AddOnRow: View {
    let addOn: AddOnProduct
    let isSelected: Bool
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                VStack(alignment: .leading) {
                    Text(addOn.name)
                    if let reason = addOn.pairingReason {
                        Text(reason).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Text("₹\(Int(addOn.price))")
            }
            .padding(10)
            .background(Color.moodishSurface)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }
}

private struct CartReviewBar: View {
    let total: Double
    let isEnabled: Bool
    let isBusy: Bool
    let onReview: () -> Void

    var body: some View {
        HStack {
            Text("₹\(Int(total))").font(.headline)
            Spacer()
            Button(action: onReview) {
                if isBusy { ProgressView() } else { Text("Review cart →") }
            }
            .buttonStyle(.borderedProminent)
            .tint(.moodishAccent)
            .disabled(!isEnabled || isBusy)
        }
        .padding()
        .background(.thinMaterial)
    }
}
