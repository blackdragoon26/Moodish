import 'package:shared_preferences/shared_preferences.dart';

/// Persists per-group-session access tokens and participant ids, keyed by
/// session id — mirrors the iOS app's Keychain-backed SessionStore.
class SessionStore {
  static String _tokenKey(String sessionId) => 'moodish.group.token.$sessionId';
  static String _participantKey(String sessionId) => 'moodish.group.participant.$sessionId';

  Future<String?> groupAccessToken(String sessionId) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_tokenKey(sessionId));
  }

  Future<void> setGroupAccessToken(String sessionId, String token) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey(sessionId), token);
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
