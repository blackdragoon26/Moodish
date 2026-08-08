import SwiftUI

enum AppTheme: String, CaseIterable {
    case system
    case light
    case dark

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    var label: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }
}

@Observable
final class ThemeStore {
    private static let key = "moodish.theme"

    var theme: AppTheme {
        didSet { UserDefaults.standard.set(theme.rawValue, forKey: Self.key) }
    }

    init() {
        let stored = UserDefaults.standard.string(forKey: Self.key)
        theme = stored.flatMap(AppTheme.init(rawValue:)) ?? .system
    }
}

extension Color {
    static let moodishAccent = Color(red: 0.86, green: 0.36, blue: 0.20)
    static let moodishBackground = Color(uiColor: .systemBackground)
    static let moodishSurface = Color(uiColor: .secondarySystemBackground)
}

/// Lets `.foregroundStyle(.moodishAccent)` dot-shorthand resolve — modifiers
/// like `foregroundStyle` are generic over `ShapeStyle`, so the static
/// member needs to live there too, not just on `Color`.
extension ShapeStyle where Self == Color {
    static var moodishAccent: Color { Color.moodishAccent }
}
