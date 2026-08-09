import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart' show canLaunchUrl, launchUrl;

import '../../app_state.dart';
import '../../core/api_client.dart';
import '../../core/google_auth_session.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _googleAuthSession = GoogleAuthSession();
  bool _isSigningIn = false;
  String? _errorMessage;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final config = state.authConfig;

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Spacer(),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: Image.asset('assets/moodish-logo.png', width: 42, height: 42, fit: BoxFit.cover),
                  ),
                  const SizedBox(width: 10),
                  Text('Moodish', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900)),
                ],
              ),
              const SizedBox(height: 20),
              Text('YOUR FOOD CONCIERGE',
                  style: Theme.of(context)
                      .textTheme
                      .labelMedium
                      ?.copyWith(color: Theme.of(context).colorScheme.primary, fontWeight: FontWeight.w700, letterSpacing: 1.2)),
              const SizedBox(height: 8),
              Text(
                "Say the mood.\nWe'll find the meal.",
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 24),
              if (state.health != null)
                Chip(label: Text(state.health!.swiggyMode == 'live' ? 'Live Swiggy' : 'Demo data')),
              const SizedBox(height: 20),
              if (_errorMessage != null) ...[
                Text(_errorMessage!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                const SizedBox(height: 12),
              ],
              _LoginButton(
                icon: Icons.g_mobiledata,
                label: _isSigningIn ? 'Signing in…' : 'Continue with Google',
                enabled: config?.google == true && !_isSigningIn,
                onTap: _signInWithGoogle,
              ),
              if (config?.google == false)
                Padding(
                  padding: const EdgeInsets.only(top: 4, bottom: 8),
                  child: Text("Google login isn't configured on this deployment yet.",
                      style: Theme.of(context).textTheme.bodySmall),
                ),
              const SizedBox(height: 8),
              if (config != null && !config.swiggy)
                _LoginButton(
                  icon: Icons.storefront,
                  label: 'Swiggy access pending',
                  enabled: true,
                  muted: true,
                  onTap: () async {
                    final uri = Uri.parse(config.swiggyAccessUrl);
                    if (await canLaunchUrl(uri)) await launchUrl(uri);
                  },
                ),
              const SizedBox(height: 8),
              if (config?.demo == true)
                _LoginButton(
                  icon: Icons.auto_awesome,
                  label: _isSigningIn ? 'Signing in…' : 'Preview with demo access',
                  enabled: !_isSigningIn,
                  onTap: _signInWithDemo,
                ),
              const Spacer(),
              SegmentedButton<ThemeMode>(
                segments: const [
                  ButtonSegment(value: ThemeMode.system, label: Text('System')),
                  ButtonSegment(value: ThemeMode.light, label: Text('Light')),
                  ButtonSegment(value: ThemeMode.dark, label: Text('Dark')),
                ],
                selected: {state.themeMode},
                onSelectionChanged: (selection) => state.setTheme(selection.first),
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _signInWithDemo() async {
    setState(() {
      _isSigningIn = true;
      _errorMessage = null;
    });
    try {
      await context.read<AppState>().loginWithDemo();
    } on ApiException catch (error) {
      setState(() => _errorMessage = error.message);
    } finally {
      if (mounted) setState(() => _isSigningIn = false);
    }
  }

  Future<void> _signInWithGoogle() async {
    setState(() {
      _isSigningIn = true;
      _errorMessage = null;
    });
    try {
      final state = context.read<AppState>();
      final token = await _googleAuthSession.signIn(state.api.googleMobileAuthorizeUrl);
      await state.loginWithGoogleToken(token);
    } on GoogleAuthException catch (error) {
      setState(() => _errorMessage = error.message);
    } on ApiException catch (error) {
      setState(() => _errorMessage = error.message);
    } finally {
      if (mounted) setState(() => _isSigningIn = false);
    }
  }
}

class _LoginButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool enabled;
  final bool muted;
  final VoidCallback? onTap;

  const _LoginButton({required this.icon, required this.label, required this.enabled, this.muted = false, this.onTap});

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: enabled ? 1 : 0.5,
      child: SizedBox(
        width: double.infinity,
        child: OutlinedButton.icon(
          onPressed: enabled ? onTap : null,
          icon: Icon(icon),
          label: Align(alignment: Alignment.centerLeft, child: Text(label)),
          style: OutlinedButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 16),
            foregroundColor: muted ? Theme.of(context).colorScheme.primary : null,
          ),
        ),
      ),
    );
  }
}
