import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app_state.dart';
import 'home_screen.dart';
import 'theme.dart';
import 'features/auth/login_screen.dart';

void main() {
  runApp(const MoodishApp());
}

class MoodishApp extends StatefulWidget {
  const MoodishApp({super.key});

  @override
  State<MoodishApp> createState() => _MoodishAppState();
}

class _MoodishAppState extends State<MoodishApp> {
  late final AppState appState;

  @override
  void initState() {
    super.initState();
    appState = AppState();
    appState.loadTheme();
    appState.bootstrap();
  }

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider.value(
      value: appState,
      child: Consumer<AppState>(
        builder: (context, state, _) {
          return MaterialApp(
            title: 'Moodish',
            debugShowCheckedModeBanner: false,
            themeMode: state.themeMode,
            theme: buildMoodishTheme(Brightness.light),
            darkTheme: buildMoodishTheme(Brightness.dark),
            home: const RootView(),
          );
        },
      ),
    );
  }
}

class RootView extends StatelessWidget {
  const RootView({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    switch (state.phase) {
      case BootstrapPhase.connecting:
        return Scaffold(
          body: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const CircularProgressIndicator(),
                const SizedBox(height: 16),
                Text(
                  state.connectingAttempt <= 2 ? 'Moodish is waking up…' : 'Reconnecting automatically…',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ],
            ),
          ),
        );
      case BootstrapPhase.failed:
        return Scaffold(
          body: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.wifi_off, size: 40),
                  const SizedBox(height: 12),
                  Text(state.failureMessage ?? 'Something went wrong.', textAlign: TextAlign.center),
                  const SizedBox(height: 16),
                  FilledButton(onPressed: () => state.bootstrap(), child: const Text('Retry')),
                ],
              ),
            ),
          ),
        );
      case BootstrapPhase.ready:
        return state.isLoggedIn ? const HomeScreen() : const LoginScreen();
    }
  }
}
