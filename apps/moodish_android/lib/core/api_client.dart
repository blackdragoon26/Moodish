import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'models/auth_models.dart';
import 'models/group_models.dart';
import 'models/recommendation_models.dart';

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override
  String toString() => message;
}

/// Thin REST client for the Moodish agent service. Mirrors the routes the
/// web app (`apps/web/public/app.js`) and the native iOS client call —
/// see docs/architecture.md and services/agent/src/server.mjs.
class ApiClient {
  static const _cookieKey = 'moodish.session.cookie';

  /// Android emulators reach the host machine's localhost via 10.0.2.2, not
  /// 127.0.0.1/localhost (those resolve to the emulator itself).
  final String baseUrl = kReleaseMode ? 'https://moodish.onrender.com' : 'http://10.0.2.2:8787';

  final http.Client _client = http.Client();
  String? _cookie;

  Future<void> restoreSession() async {
    final prefs = await SharedPreferences.getInstance();
    _cookie = prefs.getString(_cookieKey);
  }

  /// The mobile Google login flow (see auth.mjs `client=mobile`) hands back
  /// the same signed token that would otherwise be embedded in the
  /// `moodish_session` cookie, so storing it as that cookie reuses all the
  /// existing cookie-based auth plumbing instead of needing a parallel
  /// bearer-token code path.
  Future<void> setSessionToken(String token) async {
    _cookie = 'moodish_session=$token';
    await _persistCookie();
  }

  /// `/api/auth/google/start` redirects the browser straight to Google;
  /// `client=mobile` tells the backend to complete the flow by redirecting
  /// to `moodish://auth-callback?token=...` instead of a web cookie+redirect.
  Uri get googleMobileAuthorizeUrl => Uri.parse('$baseUrl/api/auth/google/start').replace(
        queryParameters: {'client': 'mobile'},
      );

  Future<void> _persistCookie() async {
    final prefs = await SharedPreferences.getInstance();
    if (_cookie != null) {
      await prefs.setString(_cookieKey, _cookie!);
    } else {
      await prefs.remove(_cookieKey);
    }
  }

  void _captureCookie(http.Response response) {
    final setCookie = response.headers['set-cookie'];
    if (setCookie == null) return;
    final first = setCookie.split(';').first.trim();
    if (first.startsWith('moodish_session=') && first.length > 'moodish_session='.length) {
      _cookie = first;
      _persistCookie();
    } else if (first == 'moodish_session=') {
      _cookie = null;
      _persistCookie();
    }
  }

  Future<T> _send<T>(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
    String? bearerToken,
    required T Function(dynamic json) parse,
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = <String, String>{'content-type': 'application/json'};
    if (_cookie != null) headers['cookie'] = _cookie!;
    if (bearerToken != null) headers['authorization'] = 'Bearer $bearerToken';

    http.Response response;
    try {
      final request = http.Request(method, uri);
      request.headers.addAll(headers);
      if (body != null) {
        request.body = jsonEncode(body);
      } else if (method == 'POST') {
        request.body = '{}';
      }
      final streamed = await _client.send(request);
      response = await http.Response.fromStream(streamed);
    } catch (error) {
      throw ApiException("Couldn't reach Moodish. Check your connection and try again.");
    }

    _captureCookie(response);

    Map<String, dynamic> decoded;
    try {
      decoded = response.body.isEmpty ? {} : jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      throw ApiException("Moodish sent back something we couldn't read. Try again.");
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(decoded['error'] as String? ?? 'Request failed (${response.statusCode})');
    }

    try {
      return parse(decoded);
    } catch (_) {
      throw ApiException("Moodish sent back something we couldn't read. Try again.");
    }
  }

  // Bootstrap & auth

  Future<BootstrapResponse> bootstrap() =>
      _send('/api/bootstrap', parse: (j) => BootstrapResponse.fromJson(j as Map<String, dynamic>));

  Future<MoodishUser> demoLogin() =>
      _send('/api/auth/demo', method: 'POST', parse: (j) => MoodishUser.fromJson((j as Map<String, dynamic>)['user'] as Map<String, dynamic>));

  Future<void> logout() async {
    await _send('/api/auth/logout', method: 'POST', parse: (j) {});
    _cookie = null;
    await _persistCookie();
  }

  // Personal flow

  Future<PlannerChatResponse> plannerChat({required String message, dynamic state}) => _send(
        '/api/planner/chat',
        method: 'POST',
        body: {'message': message, 'state': state ?? {}},
        parse: (j) => PlannerChatResponse.fromJson(j as Map<String, dynamic>),
      );

  Future<CartConfirmResult> confirmCart({
    required String recommendationId,
    required String optionId,
    required List<String> addOnProductIds,
  }) =>
      _send(
        '/api/cart/confirm',
        method: 'POST',
        body: {
          'recommendationId': recommendationId,
          'optionId': optionId,
          'addOnProductIds': addOnProductIds,
          'confirmed': true,
        },
        parse: (j) => CartConfirmResult.fromJson(j as Map<String, dynamic>),
      );

  // Corporate / group flow — bearerToken is the group-session token
  // (access-token.mjs), a different signed token than the personal cookie.

  Future<GroupSession> createGroupSession({
    required String creatorId,
    required int headcount,
    required num budgetPerPerson,
    required GroupApprovalMode approvalMode,
    String? vibe,
  }) =>
      _send(
        '/api/group-sessions',
        method: 'POST',
        body: {
          'creatorId': creatorId,
          'headcount': headcount,
          'budgetPerPerson': budgetPerPerson,
          'approvalMode': approvalMode.value,
          if (vibe != null) 'vibe': vibe,
          'platform': 'web',
        },
        parse: (j) => GroupSession.fromJson(j as Map<String, dynamic>),
      );

  Future<GroupSession> getGroupSession({required String sessionId, String? bearerToken}) => _send(
        '/api/group-sessions/$sessionId',
        bearerToken: bearerToken,
        parse: (j) => GroupSession.fromJson(j as Map<String, dynamic>),
      );

  Future<GroupSession> accessGroupSession({required String sessionId, required String invitePasscode}) => _send(
        '/api/group-sessions/$sessionId/access',
        method: 'POST',
        body: {'invitePasscode': invitePasscode},
        parse: (j) => GroupSession.fromJson(j as Map<String, dynamic>),
      );

  Future<GroupSession> submitPreferences({
    required String sessionId,
    required String participantId,
    required String dietMode,
    required String mood,
    String? dietaryRules,
    String? allergies,
    String? invitePasscode,
    String? bearerToken,
  }) =>
      _send(
        '/api/group-sessions/$sessionId/preferences',
        method: 'POST',
        body: {
          'participantId': participantId,
          'dietMode': dietMode,
          'mood': mood,
          if (dietaryRules != null) 'dietaryRules': dietaryRules,
          if (allergies != null) 'allergies': allergies,
          if (invitePasscode != null) 'invitePasscode': invitePasscode,
        },
        bearerToken: bearerToken,
        parse: (j) => GroupSession.fromJson(j as Map<String, dynamic>),
      );

  Future<GroupSession> rankGroupSession({required String sessionId, required String bearerToken}) => _send(
        '/api/group-sessions/$sessionId/rank',
        method: 'POST',
        bearerToken: bearerToken,
        parse: (j) => GroupSession.fromJson(j as Map<String, dynamic>),
      );

  Future<GroupSession> voteGroupSession({
    required String sessionId,
    required String participantId,
    required String optionId,
    String? invitePasscode,
    String? bearerToken,
  }) =>
      _send(
        '/api/group-sessions/$sessionId/vote',
        method: 'POST',
        body: {
          'participantId': participantId,
          'optionId': optionId,
          if (invitePasscode != null) 'invitePasscode': invitePasscode,
        },
        bearerToken: bearerToken,
        parse: (j) => GroupSession.fromJson(j as Map<String, dynamic>),
      );

  Future<GroupSession> selectGroupOption({required String sessionId, required String optionId, required String bearerToken}) =>
      _send(
        '/api/group-sessions/$sessionId/select',
        method: 'POST',
        body: {'optionId': optionId},
        bearerToken: bearerToken,
        parse: (j) => GroupSession.fromJson(j as Map<String, dynamic>),
      );

  Future<GroupSession> confirmGroupCart({
    required String sessionId,
    required List<String> addOnProductIds,
    required String bearerToken,
  }) =>
      _send(
        '/api/group-sessions/$sessionId/confirm-cart',
        method: 'POST',
        body: {'addOnProductIds': addOnProductIds, 'confirmed': true},
        bearerToken: bearerToken,
        parse: (j) => GroupSession.fromJson(j as Map<String, dynamic>),
      );

  Future<GroupSession> cancelGroupSession({required String sessionId, required String bearerToken}) => _send(
        '/api/group-sessions/$sessionId/cancel',
        method: 'POST',
        bearerToken: bearerToken,
        parse: (j) => GroupSession.fromJson(j as Map<String, dynamic>),
      );

  // Privacy

  Future<void> deleteTasteMemory({required String userIdHash}) =>
      _send('/api/privacy/delete-taste-memory', method: 'POST', body: {'userIdHash': userIdHash}, parse: (j) {});
}
