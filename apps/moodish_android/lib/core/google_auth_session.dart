import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';

class GoogleAuthException implements Exception {
  final String message;
  GoogleAuthException(this.message);
  @override
  String toString() => message;
}

/// Drives the native Google login handoff: opens the agent's
/// `/api/auth/google/start?client=mobile` authorize URL in a Custom Tab
/// (Chrome Custom Tabs on Android, ASWebAuthenticationSession-equivalent),
/// and the mobile-aware server redirects back to
/// moodish://auth-callback?token=... (see services/agent/src/auth.mjs).
class GoogleAuthSession {
  Future<String> signIn(Uri authorizeUrl) async {
    final Uri result;
    try {
      result = Uri.parse(
        await FlutterWebAuth2.authenticate(url: authorizeUrl.toString(), callbackUrlScheme: 'moodish'),
      );
    } catch (error) {
      throw GoogleAuthException("Couldn't complete Google sign-in.");
    }
    final token = result.queryParameters['token'];
    if (token == null || token.isEmpty) {
      throw GoogleAuthException("Google sign-in didn't return a session token");
    }
    return token;
  }
}
