import 'package:flutter/services.dart';
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
    final pkce = Pkce.generate();
    final start = await api.swiggyRequest('/api/swiggy/oauth/start', body: {'mobileChallenge': pkce.challenge});
    final code = await signIn(Uri.parse(start['authorizationUrl'] as String), parameter: 'code');
    return _exchange(api, code, pkce.verifier);
  }

  /// Google sign-in ends in the same verifier-checked exchange as Swiggy.
  Future<String> signInWithGoogle(ApiClient api) async {
    final pkce = Pkce.generate();
    final code = await signIn(api.googleMobileAuthorizeUrl(pkce.challenge), parameter: 'code');
    return _exchange(api, code, pkce.verifier);
  }

  Future<String> _exchange(ApiClient api, String code, String verifier) async {
    final result = await api.swiggyRequest('/api/auth/mobile/exchange', body: {'code': code, 'verifier': verifier});
    return result['token'] as String;
  }

  Future<String> signIn(Uri authorizeUrl, {String parameter = 'token'}) async {
    final String callback;
    try {
      callback = await FlutterWebAuth2.authenticate(url: authorizeUrl.toString(), callbackUrlScheme: 'moodish');
    } on PlatformException catch (error) {
      throw GoogleAuthException(error.code == 'CANCELED' ? 'Sign-in was cancelled. Nothing was changed.' : "Couldn't complete sign-in.");
    } catch (_) {
      throw GoogleAuthException("Couldn't complete sign-in.");
    }
    return callbackValue(Uri.parse(callback), parameter);
  }
}

/// A PKCE verifier and its S256 challenge.
class Pkce {
  final String verifier;
  final String challenge;
  Pkce._(this.verifier, this.challenge);
  factory Pkce.generate() {
    final random = Random.secure();
    String encode(List<int> bytes) => base64UrlEncode(bytes).replaceAll('=', '');
    final verifier = encode(List.generate(32, (_) => random.nextInt(256)));
    return Pkce._(verifier, encode(sha256.convert(utf8.encode(verifier)).bytes));
  }
}

/// Reads the value Moodish's server put on `moodish://auth-callback`, or turns
/// its short failure reason into something a person can act on.
String callbackValue(Uri callback, String parameter) {
  const reasons = {
    'declined': 'Swiggy connection was cancelled. Nothing was changed.',
    'expired': 'That sign-in expired or was already used. Try again.',
    'browser_mismatch': 'Finish sign-in in the window where you started it.',
    'exchange_failed': 'Swiggy did not complete the connection. Try again.',
    'update_required': 'Update Moodish to sign in.',
  };
  final error = callback.queryParameters['error'];
  if (error != null) throw GoogleAuthException(reasons[error] ?? "Couldn't complete sign-in. Try again.");
  final value = callback.queryParameters[parameter];
  if (callback.scheme != 'moodish' || value == null || value.isEmpty) {
    throw GoogleAuthException("Sign-in didn't return the expected callback value");
  }
  return value;
}
