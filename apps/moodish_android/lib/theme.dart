import 'package:flutter/material.dart';

/// Transcribed 1:1 from the web app's CSS custom properties
/// (apps/web/public/styles.css :root / [data-theme="dark"]) so all three
/// clients (web, iOS, Android) render the same palette.
class MoodishColors {
  static const accentLight = Color(0xFFEF5B36);
  static const accentDark = Color(0xFFFF7048);
  static const accentStrongLight = Color(0xFFA8341E);
  static const accentStrongDark = Color(0xFFFF9A7E);
  static const creamLight = Color(0xFFF7F2E9);
  static const creamDark = Color(0xFF171216);
  static const paperLight = Color(0xFFFFFDF8);
  static const paperDark = Color(0xFF211A1F);
  static const lineLight = Color(0xFFE6DED2);
  static const lineDark = Color(0xFF43363E);
  static const inkLight = Color(0xFF1D1714);
  static const inkDark = Color(0xFFF6EEE7);
}

ThemeData buildMoodishTheme(Brightness brightness) {
  final isDark = brightness == Brightness.dark;
  final accent = isDark ? MoodishColors.accentDark : MoodishColors.accentLight;
  final paper = isDark ? MoodishColors.paperDark : MoodishColors.paperLight;
  final ink = isDark ? MoodishColors.inkDark : MoodishColors.inkLight;
  final line = isDark ? MoodishColors.lineDark : MoodishColors.lineLight;

  final colorScheme = ColorScheme.fromSeed(seedColor: accent, brightness: brightness).copyWith(
    primary: accent,
    surface: paper,
    onSurface: ink,
    outline: line,
  );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: colorScheme,
    scaffoldBackgroundColor: isDark ? MoodishColors.creamDark : MoodishColors.creamLight,
    cardColor: paper,
    cardTheme: CardThemeData(color: paper, surfaceTintColor: Colors.transparent),
    appBarTheme: AppBarTheme(backgroundColor: isDark ? MoodishColors.creamDark : MoodishColors.creamLight, foregroundColor: ink),
  );
}
