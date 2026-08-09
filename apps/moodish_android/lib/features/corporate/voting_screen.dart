import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app_state.dart';
import '../../core/api_client.dart';
import '../../core/models/group_models.dart';

class VotingScreen extends StatefulWidget {
  final String sessionId;
  final String participantId;
  final String? invitePasscode;
  final GroupSession session;

  const VotingScreen({
    super.key,
    required this.sessionId,
    required this.participantId,
    this.invitePasscode,
    required this.session,
  });

  @override
  State<VotingScreen> createState() => _VotingScreenState();
}

class _VotingScreenState extends State<VotingScreen> {
  late GroupSession _session;
  String? _selectedOptionId;
  bool _isVoting = false;
  String? _errorMessage;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _session = widget.session;
    _pollTimer = Timer.periodic(const Duration(milliseconds: 2500), (_) async {
      if (!_session.state.isActive) {
        _pollTimer?.cancel();
        return;
      }
      try {
        final refreshed = await context.read<AppState>().api.getGroupSession(sessionId: widget.sessionId);
        if (mounted) setState(() => _session = refreshed);
      } catch (_) {
        // Ignore transient poll failures.
      }
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _vote() async {
    if (_selectedOptionId == null) return;
    setState(() {
      _isVoting = true;
      _errorMessage = null;
    });
    try {
      final refreshed = await context.read<AppState>().api.voteGroupSession(
            sessionId: widget.sessionId,
            participantId: widget.participantId,
            optionId: _selectedOptionId!,
            invitePasscode: widget.invitePasscode,
          );
      setState(() => _session = refreshed);
    } on ApiException catch (error) {
      setState(() => _errorMessage = error.message);
    } finally {
      if (mounted) setState(() => _isVoting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text("Vote for the team's lunch", style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 12),
        ..._session.options.map((option) => Card(
              child: ListTile(
                title: Text(option.restaurantName),
                subtitle: Text('₹${option.estimatedTotal}'),
                trailing: option.optionId == _selectedOptionId ? const Icon(Icons.check_circle) : null,
                onTap: () => setState(() => _selectedOptionId = option.optionId),
              ),
            )),
        if (_errorMessage != null) ...[
          const SizedBox(height: 8),
          Text(_errorMessage!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        ],
        const SizedBox(height: 12),
        FilledButton(
          onPressed: _selectedOptionId == null || _isVoting ? null : _vote,
          child: _isVoting
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Vote selected'),
        ),
      ],
    );
  }
}
