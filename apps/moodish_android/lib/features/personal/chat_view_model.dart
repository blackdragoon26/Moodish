import 'package:flutter/foundation.dart';

import '../../core/api_client.dart';
import '../../core/models/recommendation_models.dart';

enum ChatRole { user, assistant, error }

class ChatMessage {
  final ChatRole role;
  final String text;
  ChatMessage(this.role, this.text);
}

class ChatViewModel extends ChangeNotifier {
  final ApiClient api;
  ChatViewModel(this.api);

  final List<ChatMessage> messages = [];
  List<String> quickReplies = [];
  /// The most recent recommendation, retained even after its screen is
  /// popped so the user can reopen it (via a "View recommendation" button)
  /// instead of being stuck until a brand-new chat turn produces one.
  RecommendationRun? lastRecommendation;
  bool isSending = false;
  dynamic _state = <String, dynamic>{};

  Future<void> send(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty || isSending) return;
    messages.add(ChatMessage(ChatRole.user, trimmed));
    quickReplies = [];
    isSending = true;
    notifyListeners();
    try {
      final response = await api.plannerChat(message: trimmed, state: _state);
      _state = response.state;
      messages.add(ChatMessage(ChatRole.assistant, response.reply));
      quickReplies = response.quickReplies;
      if (response.recommendation != null) lastRecommendation = response.recommendation;
    } on ApiException catch (error) {
      messages.add(ChatMessage(ChatRole.error, error.message));
    } finally {
      isSending = false;
      notifyListeners();
    }
  }
}
