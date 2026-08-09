import 'package:flutter/material.dart';

class MealDialSheet extends StatefulWidget {
  final void Function(String summary) onApply;
  const MealDialSheet({super.key, required this.onApply});

  @override
  State<MealDialSheet> createState() => _MealDialSheetState();
}

class _MealDialSheetState extends State<MealDialSheet> {
  String _discovery = 'balanced';
  double _budget = 400;

  static const _labels = {
    'comfort': 'Good old favourite',
    'balanced': 'Somewhere in between',
    'explore': 'Absolutely new',
  };

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Fine-tune the mood', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          SegmentedButton<String>(
            segments: _labels.entries.map((e) => ButtonSegment(value: e.key, label: Text(e.value))).toList(),
            selected: {_discovery},
            onSelectionChanged: (s) => setState(() => _discovery = s.first),
          ),
          const SizedBox(height: 16),
          Text('Budget: ₹${_budget.round()}', style: Theme.of(context).textTheme.bodySmall),
          Slider(
            value: _budget,
            min: 150,
            max: 1000,
            divisions: 17,
            label: '₹${_budget.round()}',
            onChanged: (v) => setState(() => _budget = v),
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: () {
                Navigator.of(context).pop();
                widget.onApply(
                  "Budget around ₹${_budget.round()}, and I'm feeling ${_labels[_discovery]!.toLowerCase()}.",
                );
              },
              child: const Text('Apply'),
            ),
          ),
        ],
      ),
    );
  }
}
