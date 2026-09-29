import 'package:flutter_test/flutter_test.dart';
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

  test('rejects callbacks without the value or from another scheme', () {
    expect(() => callbackValue(Uri.parse('moodish://auth-callback'), 'code'), throwsA(isA<GoogleAuthException>()));
    expect(() => callbackValue(Uri.parse('https://evil.example/?code=abc'), 'code'), throwsA(isA<GoogleAuthException>()));
  });
}
