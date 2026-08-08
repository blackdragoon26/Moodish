import SwiftUI

struct CartReviewView: View {
    let result: CartConfirmResult
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let food = result.foodCart {
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
                        SectionCard(title: "Instamart") {
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
                        Text(result.checkoutNote ?? "This is a preview only. Checkout stays blocked until a later final-confirmation flow.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding()
                    .background(Color.moodishSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding()
            }
            .navigationTitle("Cart preview")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", action: onClose)
                }
            }
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
