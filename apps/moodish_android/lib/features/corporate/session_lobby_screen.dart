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
                        onPressed: () =>
                            Share.share(_inviteShareText(_viewModel.api.baseUrl, widget.sessionId, invitePasscode)),
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
            const SizedBox(height: 8),
            Text(
              '${session.responseCount ?? session.submissions.length} of ${session.headcount} teammates responded',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 16),
            if (session.state == GroupSessionState.collecting) ...[
              TextButton.icon(
                onPressed: _viewModel.simulateTeammates,
                icon: const Icon(Icons.build_outlined, size: 16),
                label: const Text('Simulate 3 teammates (testing only)'),
                style: TextButton.styleFrom(
                  foregroundColor: Theme.of(context).colorScheme.outline,
                  textStyle: Theme.of(context).textTheme.bodySmall,
                ),
              ),
              const SizedBox(height: 8),
              FilledButton(onPressed: _viewModel.lockAndRank, child: const Text('Close responses & build plans')),
              const SizedBox(height: 16),
            ],
            if (session.submissions.isNotEmpty) ManagerReviewList(submissions: session.submissions),
            // The creator/manager's poll returns the full `recommendation.options`
            // (with per-option coverage detail); other participants only see the
            // stripped public `options`. Each option already tries to cover every
            // teammate's request across restaurants and Instamart - it's not a
            // single-restaurant menu to multi-select from.
            if ((session.recommendation?.options ?? session.options).isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('Options', style: Theme.of(context).textTheme.titleMedium),
              ...(session.recommendation?.options ?? session.options).map((option) => Card(
                    child: ListTile(
                      title: Text(option.restaurantName),
                      subtitle: Text(
                        '₹${option.estimatedTotal}'
                        '${session.voteCounts[option.optionId] != null ? ' · ${session.voteCounts[option.optionId]} votes' : ''}'
                        '${option.coverage != null ? ' · ${option.coverage!.satisfiedCount} of ${option.coverage!.totalParticipants} covered' : ''}'
                        '${option.splitOrder ? ' · split across restaurants' : ''}',
                      ),
                      // Once any option has been approved, the backend's state
                      // machine no longer accepts a different selection - hide
                      // the other buttons entirely instead of leaving them
                      // tappable and surfacing a raw "Cannot select an option
                      // while session is awaiting_creator_confirmation" error.
                      trailing: session.approvalMode != GroupApprovalMode.managerDecides
                          ? null
                          : session.selectedOptionId == null
                              ? OutlinedButton(
                                  onPressed: () => _viewModel.approve(option.optionId),
                                  child: const Text('Approve this plan'),
                                )
                              : option.optionId == session.selectedOptionId
                                  ? const Chip(label: Text('Approved'))
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

/// Same invite link shape as the web app's own share button
/// (`${location.origin}/?group=<sessionId>&action=preferences` - see
/// apps/web/public/app.js) so recipients get a tappable URL instead of
/// bare text, on any device. Built from the app's own configured `baseUrl`
/// (not hardcoded to production) so the link actually resolves against
/// whichever backend this build talks to. The passcode is sent alongside
/// as plain text rather than embedded in the URL, matching the web app's
/// own choice not to put it in a link that could be logged or cached.
String _inviteShareText(String baseUrl, String sessionId, String? invitePasscode) {
  final url = '$baseUrl/?group=${Uri.encodeComponent(sessionId)}&action=preferences';
  return invitePasscode != null ? '$url\nPasscode: $invitePasscode' : url;
}
