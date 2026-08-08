import SwiftUI

struct HomeView: View {
    var body: some View {
        TabView {
            ChatView()
                .tabItem { Label("For me", systemImage: "fork.knife") }

            CorporateHomeView()
                .tabItem { Label("Corporate", systemImage: "person.3.fill") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .tint(.moodishAccent)
    }
}
