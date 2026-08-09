import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app_state.dart';
import '../../core/models/recommendation_models.dart';
import 'chat_view_model.dart';
import 'meal_dial_sheet.dart';
import 'meal_memory_sheet.dart';
import 'recommendation_deck_screen.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  late final ChatViewModel _viewModel;
  final _controller = TextEditingController();
  final _scrollController = ScrollController();
  String? _lastOpenedRecommendationId;

  @override
  void initState() {
    super.initState();
    _viewModel = ChatViewModel(context.read<AppState>().api);
    _viewModel.addListener(_onChanged);
  }

  void _onChanged() {
    if (!mounted) return;
    setState(() {});
    final recommendation = _viewModel.lastRecommendation;
    if (recommendation != null && recommendation.recommendationId != _lastOpenedRecommendationId) {
      _lastOpenedRecommendationId = recommendation.recommendationId;
      WidgetsBinding.instance.addPostFrameCallback((_) => _openRecommendation(recommendation));
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(_scrollController.position.maxScrollExtent,
            duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      }
    });
  }

  void _openRecommendation(RecommendationRun recommendation) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => RecommendationDeckScreen(recommendation: recommendation)));
  }

  @override
  void dispose() {
    _viewModel.removeListener(_onChanged);
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _send() {
    final text = _controller.text;
    _controller.clear();
    _viewModel.send(text);
  }

  @override
  Widget build(BuildContext context) {
    final mealMemory = context.watch<AppState>().mealMemory;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Moodish'),
        actions: [
          if (_viewModel.lastRecommendation != null)
            IconButton(
              icon: const Icon(Icons.shopping_bag_outlined),
              tooltip: 'View recommendation',
              onPressed: () => _openRecommendation(_viewModel.lastRecommendation!),
            ),
          IconButton(
            icon: const Icon(Icons.history),
            onPressed: () => showModalBottomSheet(
              context: context,
              builder: (_) => MealMemorySheet(entries: mealMemory),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: _viewModel.messages.isEmpty
                ? const _EmptyPrompt()
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.all(16),
                    itemCount: _viewModel.messages.length + (_viewModel.isSending ? 1 : 0),
                    itemBuilder: (context, index) {
                      if (index >= _viewModel.messages.length) {
                        return const _TypingBubble();
                      }
                      return _ChatBubble(message: _viewModel.messages[index]);
                    },
                  ),
          ),
          if (_viewModel.quickReplies.isNotEmpty)
            SizedBox(
              height: 44,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: _viewModel.quickReplies
                    .map((reply) => Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 4),
                          child: ActionChip(label: Text(reply), onPressed: () => _viewModel.send(reply)),
                        ))
                    .toList(),
              ),
            ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.tune),
                    onPressed: () => showModalBottomSheet(
                      context: context,
                      isScrollControlled: true,
                      builder: (_) => MealDialSheet(onApply: (summary) => _viewModel.send(summary)),
                    ),
                  ),
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      decoration: const InputDecoration(hintText: 'Say the mood…', border: OutlineInputBorder()),
                      onSubmitted: (_) => _send(),
                    ),
                  ),
                  IconButton(icon: const Icon(Icons.arrow_upward), onPressed: _send),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyPrompt extends StatelessWidget {
  const _EmptyPrompt();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text('What are you in the mood for?', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          Text("Tell me a craving, a budget, or just how you're feeling — I'll find the meal.",
              style: Theme.of(context).textTheme.bodyMedium),
        ],
      ),
    );
  }
}

class _ChatBubble extends StatelessWidget {
  final ChatMessage message;
  const _ChatBubble({required this.message});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isUser = message.role == ChatRole.user;
    final background = switch (message.role) {
      ChatRole.user => scheme.primary,
      ChatRole.assistant => scheme.surfaceContainerHighest,
      ChatRole.error => scheme.errorContainer,
    };
    final foreground = switch (message.role) {
      ChatRole.user => scheme.onPrimary,
      ChatRole.assistant => scheme.onSurface,
      ChatRole.error => scheme.onErrorContainer,
    };
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 6),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(14)),
        child: Text(message.text, style: TextStyle(color: foreground)),
      ),
    );
  }
}

class _TypingBubble extends StatelessWidget {
  const _TypingBubble();

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 6),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(14)),
        child: const SizedBox(width: 24, height: 12, child: Center(child: Text('•••'))),
      ),
    );
  }
}
