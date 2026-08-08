import SwiftUI

struct MealMemoryView: View {
    let entries: [MealMemoryEntry]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Recent meals").font(.headline)
            if entries.isEmpty {
                Text("No confirmed meal plans yet.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(entries.prefix(3)) { entry in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(entry.restaurantName ?? "Meal").font(.subheadline.weight(.medium))
                            if let cuisine = entry.cuisine {
                                Text(cuisine).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if let total = entry.total {
                            Text("₹\(Int(total))").font(.subheadline)
                        }
                    }
                    .padding(10)
                    .background(Color.moodishSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }
        }
        .padding()
    }
}
