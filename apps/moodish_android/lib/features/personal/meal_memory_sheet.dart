import 'package:flutter/material.dart';

import '../../core/models/auth_models.dart';

class MealMemorySheet extends StatelessWidget {
  final List<MealMemoryEntry> entries;
  const MealMemorySheet({super.key, required this.entries});

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Recent meals', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            if (entries.isEmpty)
              Text('No confirmed meal plans yet.', style: Theme.of(context).textTheme.bodyMedium)
            else
              ...entries.take(3).map((entry) => Card(
                    child: ListTile(
                      title: Text(entry.restaurantName ?? 'Meal'),
                      subtitle: entry.cuisine != null ? Text(entry.cuisine!) : null,
                      trailing: entry.total != null ? Text('₹${entry.total}') : null,
                    ),
                  )),
          ],
        ),
      ),
    );
  }
}
