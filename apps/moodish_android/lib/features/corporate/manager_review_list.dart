import 'package:flutter/material.dart';

import '../../core/models/group_models.dart';

/// Manager-only submissions list — visible when the server returns the
/// private session view (creator/co-manager holds the bearer token).
class ManagerReviewList extends StatelessWidget {
  final List<GroupSubmission> submissions;
  const ManagerReviewList({super.key, required this.submissions});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Incoming preferences (${submissions.length})', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        ...submissions.map((submission) => Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(submission.mood ?? 'No mood given', style: Theme.of(context).textTheme.bodyMedium),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 8,
                      children: [
                        if (submission.dietMode != null) Chip(label: Text(submission.dietMode!)),
                        if (submission.allergies.isNotEmpty)
                          Chip(
                            label: Text('Allergy: ${submission.allergies.join(", ")}'),
                            backgroundColor: Theme.of(context).colorScheme.errorContainer,
                          ),
                      ],
                    ),
                    if (submission.dietaryRules.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(submission.dietaryRules.join(', '), style: Theme.of(context).textTheme.bodySmall),
                      ),
                  ],
                ),
              ),
            )),
      ],
    );
  }
}
