import 'package:flutter_test/flutter_test.dart';
import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:moodish/core/api_client.dart';
import 'package:moodish/core/google_auth_session.dart';

void main() {
  test('returns the callback code for the app to exchange', () {
    expect(callbackValue(Uri.parse('moodish://auth-callback?code=abc123'), 'code'), 'abc123');
  });

  test('turns server failure reasons into readable messages', () {
    for (final entry in {
      'declined': 'cancelled',
      'expired': 'expired',
      'exchange_failed': 'did not complete',
      'something-new': "Couldn't complete",
    }.entries) {
      expect(
        () => callbackValue(Uri.parse('moodish://auth-callback?error=${entry.key}'), 'code'),
        throwsA(isA<GoogleAuthException>().having((e) => e.message, 'message', contains(entry.value))),
      );
    }
  });

  test('Google and Swiggy failures share provider-neutral messages', () {
    for (final reason in ['declined', 'exchange_failed']) {
      expect(
        () => callbackValue(Uri.parse('moodish://auth-callback?error=$reason'), 'code'),
        throwsA(isA<GoogleAuthException>().having((e) => e.message, 'message', isNot(contains('Swiggy')))),
      );
    }
  });

  test('rejects callbacks without the value or from another scheme', () {
    expect(() => callbackValue(Uri.parse('moodish://auth-callback'), 'code'), throwsA(isA<GoogleAuthException>()));
    expect(() => callbackValue(Uri.parse('https://evil.example/?code=abc'), 'code'), throwsA(isA<GoogleAuthException>()));
  });

  test('PKCE challenge is the S256 of a fresh 43-character verifier', () {
    final a = Pkce.generate();
    final b = Pkce.generate();
    expect(a.verifier.length, 43);
    expect(a.verifier, isNot(b.verifier));
    expect(a.challenge, base64UrlEncode(sha256.convert(utf8.encode(a.verifier)).bytes).replaceAll('=', ''));
  });

  test('the Google start URL carries the challenge and never asks for a token', () {
    final url = ApiClient().googleMobileAuthorizeUrl('challenge-value');
    expect(url.path, '/api/auth/google/start');
    expect(url.queryParameters, {'client': 'mobile', 'challenge': 'challenge-value'});
  });

  test('an older-server style token callback is not accepted as a code', () {
    expect(() => callbackValue(Uri.parse('moodish://auth-callback?token=abc'), 'code'), throwsA(isA<GoogleAuthException>()));
    expect(() => callbackValue(Uri.parse('moodish://auth-callback?error=update_required'), 'code'),
        throwsA(isA<GoogleAuthException>().having((e) => e.message, 'message', contains('Update Moodish'))));
  });
}
