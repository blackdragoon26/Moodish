import 'dart:async';
import 'package:flutter/foundation.dart';

import '../../core/api_client.dart';
import '../../core/session_store.dart';
import '../../core/models/group_models.dart';

/// Polls every 2.5s while the session is active, matching the web app's
/// manager polling loop, and exposes the state-machine-gated manager actions.
class GroupSessionViewModel extends ChangeNotifier {
  final ApiClient api;
  final SessionStore sessionStore;
  final String sessionId;

  GroupSession? session;
  String? errorMessage;
  bool isBusy = false;
  Timer? _pollTimer;

  GroupSessionViewModel({required this.api, required this.sessionStore, required this.sessionId, GroupSession? initial})
      : session = initial;

  Future<String?> get _accessToken => sessionStore.groupAccessToken(sessionId);

  void startPolling() {
    _pollTimer?.cancel();
    refresh();
    _pollTimer = Timer.periodic(const Duration(milliseconds: 2500), (_) async {
      if (session != null && !session!.state.isActive) {
        _pollTimer?.cancel();
        return;
      }
      await refresh();
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> refresh() async {
    try {
      session = await api.getGroupSession(sessionId: sessionId, bearerToken: await _accessToken);
      notifyListeners();
    } on ApiException catch (error) {
      errorMessage = error.message;
      notifyListeners();
    }
  }

  Future<void> simulateTeammates() async {
    final fixtures = [
      ('comfort food', 'veg'),
      ('something light', 'non_veg'),
      ('spicy and exciting', 'veg'),
    ];
    final token = await _accessToken;
    for (var i = 0; i < fixtures.length; i++) {
      try {
        session = await api.submitPreferences(
          sessionId: sessionId,
          participantId: 'demo-teammate-${i + 1}',
          dietMode: fixtures[i].$2,
          mood: fixtures[i].$1,
          bearerToken: token,
        );
      } on ApiException catch (error) {
        errorMessage = error.message;
      }
    }
    notifyListeners();
  }

  Future<void> _run(Future<GroupSession> Function(String token) operation) async {
    final token = await _accessToken;
    if (token == null) return;
    isBusy = true;
    errorMessage = null;
    notifyListeners();
    try {
      session = await operation(token);
    } on ApiException catch (error) {
      errorMessage = error.message;
    } finally {
      isBusy = false;
      notifyListeners();
    }
  }

  Future<void> lockAndRank() => _run((token) => api.rankGroupSession(sessionId: sessionId, bearerToken: token));

  Future<void> approve(String optionId) =>
      _run((token) => api.selectGroupOption(sessionId: sessionId, optionId: optionId, bearerToken: token));

  Future<void> confirmCart({List<String> addOnProductIds = const []}) =>
      _run((token) => api.confirmGroupCart(sessionId: sessionId, addOnProductIds: addOnProductIds, bearerToken: token));

  Future<void> cancel() => _run((token) => api.cancelGroupSession(sessionId: sessionId, bearerToken: token));
}
