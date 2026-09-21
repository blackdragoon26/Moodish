import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists per-group-session access tokens and participant ids, keyed by
/// session id — mirrors the iOS app's Keychain-backed SessionStore.
class SessionStore {
  static const _secure = FlutterSecureStorage();
  static String _tokenKey(String sessionId) => 'moodish.group.token.$sessionId';
  static String _participantKey(String sessionId) => 'moodish.group.participant.$sessionId';

  Future<String?> groupAccessToken(String sessionId) async {
    final prefs = await SharedPreferences.getInstance();
    final token = await _secure.read(key: _tokenKey(sessionId)) ?? prefs.getString(_tokenKey(sessionId));
    if (token != null) await _secure.write(key: _tokenKey(sessionId), value: token);
    await prefs.remove(_tokenKey(sessionId));
    return token;
  }

  Future<void> setGroupAccessToken(String sessionId, String token) async {
    await _secure.write(key: _tokenKey(sessionId), value: token);
  }

  Future<String?> participantId(String sessionId) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_participantKey(sessionId));
  }

  Future<void> setParticipantId(String sessionId, String id) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_participantKey(sessionId), id);
  }
}
