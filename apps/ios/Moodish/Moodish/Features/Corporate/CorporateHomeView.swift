import SwiftUI

struct CorporateHomeView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Moodish Enterprise").font(.title2.weight(.semibold))
                    Text("Manager sets policy → employees answer privately → Moodish consolidates → creator confirms.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .background(Color.moodishSurface)
                .clipShape(RoundedRectangle(cornerRadius: 16))

                NavigationLink("Create a group order") {
                    CreateSessionView()
                }
                .buttonStyle(.borderedProminent)
                .tint(.moodishAccent)

                NavigationLink("Join with an invite code") {
                    ParticipantJoinView()
                }
                .buttonStyle(.bordered)

                Spacer()
            }
            .padding()
            .navigationTitle("Corporate")
        }
    }
}
