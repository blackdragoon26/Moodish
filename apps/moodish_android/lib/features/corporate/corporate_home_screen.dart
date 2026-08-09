import 'package:flutter/material.dart';

import 'create_session_screen.dart';
import 'participant_join_screen.dart';

class CorporateHomeScreen extends StatelessWidget {
  const CorporateHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Corporate')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Moodish Enterprise', style: Theme.of(context).textTheme.titleLarge),
                    const SizedBox(height: 8),
                    Text(
                      'Manager sets policy → employees answer privately → Moodish consolidates → creator confirms.',
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: () =>
                  Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CreateSessionScreen())),
              child: const Text('Create a group order'),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () =>
                  Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ParticipantJoinScreen())),
              child: const Text('Join with an invite code'),
            ),
          ],
        ),
      ),
    );
  }
}
