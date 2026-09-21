import SwiftUI

/// Sheet wrapper with a "Done" toolbar button that actually dismisses -
/// only appropriate when presented modally (see RecommendationDeckView's
/// `.sheet`). Group sessions embed `CartReviewContent` directly inline
/// instead, since there's nothing there to dismiss.
struct CartReviewView: View {
    let result: CartConfirmResult
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                CartReviewContent(result: result)
                    .padding()
            }
            .navigationTitle("Cart result")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", action: onClose)
                }
            }
        }
    }
}

/// Content-only cart preview, reused standalone (above, inside a sheet)
/// and embedded inline in the group-session lobby list.
struct CartReviewContent: View {
    let result: CartConfirmResult

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // A group cart can span multiple restaurants to cover every
            // teammate's request - render all of `foodCarts` when present
            // rather than only the first-restaurant `foodCart` view, or a
            // split order silently loses everyone past the first restaurant.
            ForEach(Array((result.foodCarts?.isEmpty == false ? result.foodCarts! : [result.foodCart].compactMap { $0 }).enumerated()), id: \.offset) { _, food in
                SectionCard(title: "Swiggy Food") {
                    if let restaurant = food.restaurant {
                        Text(restaurant).font(.headline)
                    }
                    ForEach(food.items ?? []) { item in
                        Text("• \(item.name)").font(.subheadline)
                    }
                    if let total = food.total {
                        Text("₹\(Int(total))").font(.subheadline.weight(.semibold))
                    }
                }
            }

            if let instamart = result.instamartCartPreview, let items = instamart.items, !items.isEmpty {
                SectionCard(title: "Instamart preview") {
                    ForEach(items) { item in
                        Text("• \(item.name) — ₹\(Int(item.price))").font(.subheadline)
                    }
                    if let note = instamart.note {
                        Text(note).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Label("Checkout stays blocked", systemImage: "lock.fill")
                    .font(.subheadline.weight(.semibold))
                Text(result.checkoutNote ?? "No order was placed. Instamart remains a preview.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding()
            .background(Color.moodishSurface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }
}

private struct SectionCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color.moodishSurface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct LiveCartReviewSheet: View {
    let option: RecommendationOption
    let prepare: (String?) async throws -> CartPreparation
    let confirm: (String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var restaurantId = ""
    @State private var review: CartPreparation?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if let sources = option.foodSources, sources.count > 1 {
                    Picker("Restaurant to prepare", selection: $restaurantId) {
                        Text("Choose one restaurant").tag("")
                        ForEach(sources) { s in Text(s.restaurantName).tag(s.restaurantId) }
                    }.disabled(review != nil)
                    Text("The other restaurant plans remain previews.")
                }
                if let review {
                    Section("Delivery") { Text("\(review.address.label) · \(review.address.display)") }
                    Section("Food items") {
                        ForEach(review.items) { i in Text("\(i.quantity) × \(i.name) · ₹\(Int(i.price))") }
                        Text("Items estimate: ₹\(Int(review.estimatedItemTotal))")
                    }
                    if review.replacesExistingCart {
                        Section("Current cart will change") {
                            Text(review.existingCart.restaurant ?? "Existing Food cart")
                            ForEach(review.existingCart.items ?? []) { i in Text(i.name) }
                        }
                    }
                    Text(review.note)
                    Button("Confirm Food cart update") { Task {
                        busy = true
                        defer { busy = false }
                        do { try await confirm(review.preparationId); dismiss() }
                        catch { self.error = error.localizedDescription }
                    } }.disabled(busy)
                } else {
                    Button("Load current cart and prices") { Task {
                        busy = true
                        defer { busy = false }
                        do { review = try await prepare(restaurantId.isEmpty ? nil : restaurantId) }
                        catch { self.error = error.localizedDescription }
                    } }.disabled(busy || ((option.foodSources?.count ?? 0) > 1 && restaurantId.isEmpty))
                }
                if let error { Text(error).foregroundStyle(.red) }
                if busy { ProgressView() }
            }
            .navigationTitle("Review Food cart")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) } }
        }
    }
}
