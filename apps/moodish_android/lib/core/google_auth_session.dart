import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'api_client.dart';

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
  Future<String> connectSwiggy(ApiClient api) async {
    final random = Random.secure();
    String encode(List<int> bytes) => base64UrlEncode(bytes).replaceAll('=', '');
    final verifier = encode(List.generate(32, (_) => random.nextInt(256)));
    final challenge = encode(sha256.convert(utf8.encode(verifier)).bytes);
    final start = await api.swiggyRequest('/api/swiggy/oauth/start', body: {'mobileChallenge': challenge});
    final code = await signIn(Uri.parse(start['authorizationUrl'] as String), parameter: 'code');
    final result = await api.swiggyRequest('/api/auth/mobile/exchange', body: {'code': code, 'verifier': verifier});
    return result['token'] as String;
  }

  Future<String> signIn(Uri authorizeUrl, {String parameter = 'token'}) async {
    final Uri result;
    try {
      result = Uri.parse(
        await FlutterWebAuth2.authenticate(url: authorizeUrl.toString(), callbackUrlScheme: 'moodish'),
      );
    } catch (error) {
      throw GoogleAuthException("Couldn't complete sign-in.");
    }
    final token = result.queryParameters[parameter];
    if (token == null || token.isEmpty) {
      throw GoogleAuthException("Sign-in didn't return the expected callback value");
    }
    return token;
  }
}
