import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';

import '../../app_state.dart';
import '../../core/api_client.dart';
import '../../core/models/group_models.dart';
import 'voting_screen.dart';

class ParticipantJoinScreen extends StatefulWidget {
  const ParticipantJoinScreen({super.key});

  @override
  State<ParticipantJoinScreen> createState() => _ParticipantJoinScreenState();
}

class _ParticipantJoinScreenState extends State<ParticipantJoinScreen> {
  final _sessionIdController = TextEditingController();
  final _passcodeController = TextEditingController();
  bool _isJoining = false;
  String? _errorMessage;

  Future<void> _join() async {
    setState(() {
      _isJoining = true;
      _errorMessage = null;
    });
    try {
      final api = context.read<AppState>().api;
      final sessionId = _sessionIdController.text.trim();
      final passcode = _passcodeController.text.trim();
      if (passcode.isEmpty) {
        await api.getGroupSession(sessionId: sessionId);
      } else {
        await api.accessGroupSession(sessionId: sessionId, invitePasscode: passcode);
      }
      if (!mounted) return;
      Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => ParticipantPreferenceScreen(sessionId: sessionId, invitePasscode: passcode.isEmpty ? null : passcode),
      ));
    } on ApiException catch (error) {
      setState(() => _errorMessage = error.message);
    } finally {
      if (mounted) setState(() => _isJoining = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Join group order')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          TextField(controller: _sessionIdController, decoration: const InputDecoration(labelText: 'Invite code')),
          const SizedBox(height: 12),
          TextField(
              controller: _passcodeController, decoration: const InputDecoration(labelText: 'Passcode (if required)')),
          const SizedBox(height: 20),
          if (_errorMessage != null) ...[
            Text(_errorMessage!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            const SizedBox(height: 12),
          ],
          FilledButton(
            onPressed: _sessionIdController.text.isEmpty || _isJoining ? null : _join,
            child: _isJoining
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Join'),
          ),
        ],
      ),
    );
  }
}

class ParticipantPreferenceScreen extends StatefulWidget {
  final String sessionId;
  final String? invitePasscode;
  const ParticipantPreferenceScreen({super.key, required this.sessionId, this.invitePasscode});

  @override
  State<ParticipantPreferenceScreen> createState() => _ParticipantPreferenceScreenState();
}

class _ParticipantPreferenceScreenState extends State<ParticipantPreferenceScreen> {
  static const _dietOptions = ['veg', 'non_veg', 'vegan'];
  String _dietMode = 'veg';
  final _moodController = TextEditingController();
  final _allergiesController = TextEditingController();
  bool _isSubmitting = false;
  String? _errorMessage;
  GroupSession? _session;
  late String _participantId;

  @override
  void initState() {
    super.initState();
    _loadParticipantId();
  }

  Future<void> _loadParticipantId() async {
    final store = context.read<AppState>().sessionStore;
    var id = await store.participantId(widget.sessionId);
    if (id == null) {
      id = 'participant-${const Uuid().v4().substring(0, 8)}';
      await store.setParticipantId(widget.sessionId, id);
    }
    if (mounted) setState(() => _participantId = id!);
  }

  Future<void> _submit() async {
    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });
    try {
      final api = context.read<AppState>().api;
      final result = await api.submitPreferences(
        sessionId: widget.sessionId,
        participantId: _participantId,
        dietMode: _dietMode,
        mood: _moodController.text.trim(),
        allergies: _allergiesController.text.isEmpty ? null : _allergiesController.text,
        invitePasscode: widget.invitePasscode,
      );
      setState(() => _session = result);
    } on ApiException catch (error) {
      setState(() => _errorMessage = error.message);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = _session;
    return Scaffold(
      appBar: AppBar(title: const Text('Your lunch')),
      body: session != null && session.state == GroupSessionState.voting
          ? VotingScreen(
              sessionId: widget.sessionId,
              participantId: _participantId,
              invitePasscode: widget.invitePasscode,
              session: session,
            )
          : session != null && !session.state.isActive
              ? _TerminalStateView(state: session.state)
              : ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    DropdownButtonFormField<String>(
                      initialValue: _dietMode,
                      decoration: const InputDecoration(labelText: 'Diet'),
                      items: _dietOptions
                          .map((d) => DropdownMenuItem(value: d, child: Text(d.replaceAll('_', ' '))))
                          .toList(),
                      onChanged: (v) => setState(() => _dietMode = v ?? _dietMode),
                    ),
                    const SizedBox(height: 12),
                    TextField(controller: _moodController, decoration: const InputDecoration(labelText: 'Mood / craving')),
                    const SizedBox(height: 12),
                    TextField(
                        controller: _allergiesController,
                        decoration: const InputDecoration(labelText: 'Allergies (optional)')),
                    const SizedBox(height: 20),
                    if (_errorMessage != null) ...[
                      Text(_errorMessage!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                      const SizedBox(height: 12),
                    ],
                    FilledButton(
                      onPressed: _moodController.text.isEmpty || _isSubmitting ? null : _submit,
                      child: _isSubmitting
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Text('Submit preference'),
                    ),
                  ],
                ),
    );
  }
}

class _TerminalStateView extends StatelessWidget {
  final GroupSessionState state;
  const _TerminalStateView({required this.state});

  String get _message {
    switch (state) {
      case GroupSessionState.locked:
        return 'Responses are locked. Moodish is preparing options.';
      case GroupSessionState.ranking:
        return 'Ranking the best options for the team.';
      case GroupSessionState.awaitingManager:
        return 'Waiting for the manager to approve a plan.';
      case GroupSessionState.awaitingCreatorConfirmation:
        return 'Waiting for the creator to confirm the final cart.';
      case GroupSessionState.cartBuilt:
        return 'The cart is confirmed. Enjoy your meal!';
      case GroupSessionState.cancelled:
        return 'This session was cancelled.';
      case GroupSessionState.expired:
        return 'This session has expired.';
      default:
        return 'Please check back shortly.';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(_message, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyLarge),
      ),
    );
  }
}
