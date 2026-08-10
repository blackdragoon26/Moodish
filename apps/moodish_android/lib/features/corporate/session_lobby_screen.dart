import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../app_state.dart';
import '../../core/models/group_models.dart';
import '../personal/cart_review_screen.dart';
import 'group_session_view_model.dart';
import 'manager_review_list.dart';

class SessionLobbyScreen extends StatefulWidget {
  final String sessionId;
  final GroupSession? initial;
  const SessionLobbyScreen({super.key, required this.sessionId, this.initial});

  @override
  State<SessionLobbyScreen> createState() => _SessionLobbyScreenState();
}

class _SessionLobbyScreenState extends State<SessionLobbyScreen> {
  late final GroupSessionViewModel _viewModel;

  @override
  void initState() {
    super.initState();
    final state = context.read<AppState>();
    _viewModel = GroupSessionViewModel(
      api: state.api,
      sessionStore: state.sessionStore,
      sessionId: widget.sessionId,
      initial: widget.initial,
    );
    _viewModel.addListener(() => setState(() {}));
    _viewModel.startPolling();
  }

  @override
  void dispose() {
    _viewModel.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final session = _viewModel.session;
    // The passcode is only ever returned once, at creation — later polls
    // won't carry it, so it's read from `widget.initial`, not `session`.
    final invitePasscode = widget.initial?.invitePasscode;

    return Scaffold(
      appBar: AppBar(title: const Text('Group order')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Invite code', style: Theme.of(context).textTheme.bodySmall),
                            SelectableText(widget.sessionId, style: const TextStyle(fontFamily: 'monospace')),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.share),
                        onPressed: () => Share.share(
                          invitePasscode != null
                              ? 'Join my Moodish group order: code ${widget.sessionId}, passcode $invitePasscode'
                              : 'Join my Moodish group order: code ${widget.sessionId}',
                        ),
                      ),
                    ],
                  ),
                  if (invitePasscode != null) ...[
                    const SizedBox(height: 8),
                    Text('Passcode', style: Theme.of(context).textTheme.bodySmall),
                    SelectableText(invitePasscode, style: const TextStyle(fontFamily: 'monospace')),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          if (session != null) ...[
            Chip(label: Text(session.state.label)),
            const SizedBox(height: 16),
            if (session.state == GroupSessionState.collecting) ...[
              OutlinedButton(onPressed: _viewModel.simulateTeammates, child: const Text('Simulate 3 teammates')),
              const SizedBox(height: 8),
              FilledButton(onPressed: _viewModel.lockAndRank, child: const Text('Close responses & build plans')),
              const SizedBox(height: 16),
            ],
            if (session.submissions.isNotEmpty) ManagerReviewList(submissions: session.submissions),
            if (session.options.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('Options', style: Theme.of(context).textTheme.titleMedium),
              ...session.options.map((option) => Card(
                    child: ListTile(
                      title: Text(option.restaurantName),
                      subtitle: Text(
                        '₹${option.estimatedTotal}'
                        '${session.voteCounts[option.optionId] != null ? ' · ${session.voteCounts[option.optionId]} votes' : ''}',
                      ),
                      trailing: session.approvalMode == GroupApprovalMode.managerDecides
                          ? OutlinedButton(
                              onPressed: option.optionId == session.selectedOptionId
                                  ? null
                                  : () => _viewModel.approve(option.optionId),
                              child: Text(option.optionId == session.selectedOptionId ? 'Approved' : 'Approve this plan'),
                            )
                          : null,
                    ),
                  )),
            ],
            if (session.state == GroupSessionState.awaitingCreatorConfirmation && session.selectedOptionId != null) ...[
              const SizedBox(height: 8),
              FilledButton(
                onPressed: () => _viewModel.confirmCart(),
                child: const Text('Creator: confirm final cart'),
              ),
            ],
            if (session.cart != null) ...[
              const SizedBox(height: 16),
              CartReviewContent(result: session.cart!),
            ],
            if (session.state.isActive) ...[
              const SizedBox(height: 16),
              TextButton(
                onPressed: _viewModel.cancel,
                style: TextButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error),
                child: const Text('Cancel session'),
              ),
            ],
          ],
          if (_viewModel.errorMessage != null) ...[
            const SizedBox(height: 12),
            Text(_viewModel.errorMessage!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
        ],
      ),
    );
  }
}
