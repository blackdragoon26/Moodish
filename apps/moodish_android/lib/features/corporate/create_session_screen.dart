import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app_state.dart';
import '../../core/api_client.dart';
import '../../core/models/group_models.dart';
import 'session_lobby_screen.dart';

class CreateSessionScreen extends StatefulWidget {
  const CreateSessionScreen({super.key});

  @override
  State<CreateSessionScreen> createState() => _CreateSessionScreenState();
}

class _CreateSessionScreenState extends State<CreateSessionScreen> {
  int _headcount = 6;
  double _budgetPerPerson = 250;
  GroupApprovalMode _approvalMode = GroupApprovalMode.managerDecides;
  final _vibeController = TextEditingController();
  bool _isCreating = false;
  String? _errorMessage;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('New group order')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('Headcount: $_headcount', style: Theme.of(context).textTheme.titleMedium),
          Row(
            children: [
              IconButton(onPressed: () => setState(() => _headcount = (_headcount - 1).clamp(2, 50)), icon: const Icon(Icons.remove)),
              Expanded(child: Text('$_headcount people', textAlign: TextAlign.center)),
              IconButton(onPressed: () => setState(() => _headcount = (_headcount + 1).clamp(2, 50)), icon: const Icon(Icons.add)),
            ],
          ),
          const SizedBox(height: 12),
          Text('Budget per person: ₹${_budgetPerPerson.round()}', style: Theme.of(context).textTheme.bodyMedium),
          Slider(
            value: _budgetPerPerson,
            min: 100,
            max: 1000,
            divisions: 18,
            label: '₹${_budgetPerPerson.round()}',
            onChanged: (v) => setState(() => _budgetPerPerson = v),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<GroupApprovalMode>(
            initialValue: _approvalMode,
            decoration: const InputDecoration(labelText: 'Approval mode'),
            items: GroupApprovalMode.values
                .map((mode) => DropdownMenuItem(value: mode, child: Text(mode.displayName)))
                .toList(),
            onChanged: (mode) => setState(() => _approvalMode = mode ?? _approvalMode),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _vibeController,
            decoration: const InputDecoration(labelText: 'Vibe (optional)', hintText: 'e.g. celebratory, quick weekday lunch'),
          ),
          const SizedBox(height: 20),
          if (_errorMessage != null) ...[
            Text(_errorMessage!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            const SizedBox(height: 12),
          ],
          FilledButton(
            onPressed: _isCreating ? null : _createSession,
            child: _isCreating
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Create session'),
          ),
        ],
      ),
    );
  }

  Future<void> _createSession() async {
    setState(() {
      _isCreating = true;
      _errorMessage = null;
    });
    try {
      final state = context.read<AppState>();
      final creatorId = state.user?.id ?? 'manager-${DateTime.now().millisecondsSinceEpoch}';
      final session = await state.api.createGroupSession(
        creatorId: creatorId,
        headcount: _headcount,
        budgetPerPerson: _budgetPerPerson,
        approvalMode: _approvalMode,
        vibe: _vibeController.text.isEmpty ? null : _vibeController.text,
      );
      if (session.accessToken != null) {
        await state.sessionStore.setGroupAccessToken(session.sessionId, session.accessToken!);
      }
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => SessionLobbyScreen(sessionId: session.sessionId, initial: session)),
      );
    } on ApiException catch (error) {
      setState(() => _errorMessage = error.message);
    } finally {
      if (mounted) setState(() => _isCreating = false);
    }
  }
}
