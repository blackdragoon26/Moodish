import SwiftUI

enum DiscoveryMode: String, CaseIterable, Identifiable {
    case comfort, balanced, explore
    var id: String { rawValue }

    var label: String {
        switch self {
        case .comfort: return "Good old favourite"
        case .balanced: return "Somewhere in between"
        case .explore: return "Absolutely new"
        }
    }
}

/// Mirrors the web app's "meal dial" — a discovery-mode segmented control
/// plus a ₹150–1000 budget slider — that gets folded into the next chat
/// message rather than sent as its own endpoint (there isn't one).
struct MealDialView: View {
    @State private var discoveryMode: DiscoveryMode = .balanced
    @State private var budget: Double = 400
    let onApply: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Fine-tune the mood")
                .font(.subheadline.weight(.semibold))

            Picker("Discovery", selection: $discoveryMode) {
                ForEach(DiscoveryMode.allCases) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            VStack(alignment: .leading, spacing: 4) {
                Text("Budget: ₹\(Int(budget))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Slider(value: $budget, in: 150...1000, step: 10)
            }

            Button("Apply") {
                onApply("Budget around ₹\(Int(budget)), and I'm feeling \(discoveryMode.label.lowercased()).")
            }
            .buttonStyle(.borderedProminent)
            .tint(.moodishAccent)
            .frame(maxWidth: .infinity)
        }
        .padding()
        .background(Color.moodishSurface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal)
    }
}
