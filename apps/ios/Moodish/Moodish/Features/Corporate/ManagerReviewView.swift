import SwiftUI

/// Manager-only submissions list — visible when the server returns the
/// private session view (creator/co-manager holds the bearer token).
struct ManagerReviewView: View {
    let submissions: [GroupSubmission]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Incoming preferences (\(submissions.count))").font(.headline)
            ForEach(submissions) { submission in
                VStack(alignment: .leading, spacing: 2) {
                    Text(submission.mood ?? "No mood given").font(.subheadline.weight(.medium))
                    HStack(spacing: 8) {
                        if let dietMode = submission.dietMode {
                            Tag(text: dietMode)
                        }
                        if let allergies = submission.allergies, !allergies.isEmpty {
                            Tag(text: "Allergy: \(allergies.joined(separator: ", "))", color: .red)
                        }
                    }
                    if let rules = submission.dietaryRules, !rules.isEmpty {
                        Text(rules.joined(separator: ", ")).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.moodishSurface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
    }
}

private struct Tag: View {
    let text: String
    var color: Color = .moodishAccent

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }
}
