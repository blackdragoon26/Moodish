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
    /// Hex initializer so these can be transcribed 1:1 from the web app's
    /// CSS custom properties (apps/web/public/styles.css :root / [data-theme="dark"])
    /// instead of hand-converted RGB floats that drift from the source of truth.
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }

    private static func adaptive(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(Color(hex: dark)) : UIColor(Color(hex: light))
        })
    }

    /// --accent / --accent (dark)
    static let moodishAccent = adaptive(light: 0xEF5B36, dark: 0xFF7048)
    /// --accent-dark / --accent-dark (dark)
    static let moodishAccentStrong = adaptive(light: 0xA8341E, dark: 0xFF9A7E)
    /// --cream (page background)
    static let moodishBackground = adaptive(light: 0xF7F2E9, dark: 0x171216)
    /// --paper (card/surface background)
    static let moodishSurface = adaptive(light: 0xFFFDF8, dark: 0x211A1F)
    /// --line (hairline borders)
    static let moodishLine = adaptive(light: 0xE6DED2, dark: 0x43363E)
    /// --muted (secondary text)
    static let moodishMuted = adaptive(light: 0x746B65, dark: 0xB9AAA2)
}

/// Lets `.foregroundStyle(.moodishAccent)` dot-shorthand resolve — modifiers
/// like `foregroundStyle` are generic over `ShapeStyle`, so the static
/// member needs to live there too, not just on `Color`.
extension ShapeStyle where Self == Color {
    static var moodishAccent: Color { Color.moodishAccent }
}
