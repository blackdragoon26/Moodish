import 'dart:async';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'core/api_client.dart';
import 'core/session_store.dart';
import 'core/models/auth_models.dart';

enum BootstrapPhase { connecting, ready, failed }

class AppState extends ChangeNotifier {
  final ApiClient api = ApiClient();
  final SessionStore sessionStore = SessionStore();

  BootstrapPhase phase = BootstrapPhase.connecting;
  int connectingAttempt = 1;
  String? failureMessage;

  AuthConfig? authConfig;
  MoodishUser? user;
  List<MealMemoryEntry> mealMemory = [];
  HealthStatus? health;

  ThemeMode themeMode = ThemeMode.system;

  bool get isLoggedIn => user != null;

  Future<void> loadTheme() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('moodish.theme');
    themeMode = switch (saved) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
    notifyListeners();
  }

  Future<void> setTheme(ThemeMode mode) async {
    themeMode = mode;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('moodish.theme', switch (mode) {
      ThemeMode.light => 'light',
      ThemeMode.dark => 'dark',
      ThemeMode.system => 'system',
    });
    notifyListeners();
  }

  Future<void> bootstrap() async {
    await api.restoreSession();
    const maxAttempts = 6;
    var attempt = 1;
    while (attempt <= maxAttempts) {
      phase = BootstrapPhase.connecting;
      connectingAttempt = attempt;
      notifyListeners();
      try {
        final result = await api.bootstrap();
        authConfig = result.config;
        user = result.user;
        mealMemory = result.mealMemory;
        health = result.health;
        phase = BootstrapPhase.ready;
        notifyListeners();
        return;
      } catch (_) {
        if (attempt == maxAttempts) {
          phase = BootstrapPhase.failed;
          failureMessage = 'Moodish is taking longer than usual to wake up. Pull to retry.';
          notifyListeners();
          return;
        }
        final delayMs = (300 * (1 << attempt)).clamp(0, 5000);
        await Future.delayed(Duration(milliseconds: delayMs));
        attempt += 1;
      }
    }
  }

  Future<void> loginWithDemo() async {
    final loggedInUser = await api.demoLogin();
    user = loggedInUser;
    notifyListeners();
  }

  Future<void> logout() async {
    await api.logout();
    user = null;
    mealMemory = [];
    notifyListeners();
  }
}
