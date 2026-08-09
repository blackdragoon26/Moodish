import 'package:flutter/material.dart';

import '../../core/models/recommendation_models.dart';

class CartReviewScreen extends StatelessWidget {
  final CartConfirmResult result;
  const CartReviewScreen({super.key, required this.result});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Cart preview')),
      body: ListView(padding: const EdgeInsets.all(16), children: [CartReviewContent(result: result)]),
    );
  }
}

/// Content-only cart preview, reused standalone (above, with its own Scaffold)
/// and embedded inline in the group-session lobby list.
class CartReviewContent extends StatelessWidget {
  final CartConfirmResult result;
  const CartReviewContent({super.key, required this.result});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (result.foodCart != null)
          _Section(
            title: 'Swiggy Food',
            children: [
              if (result.foodCart!.restaurant != null)
                Text(result.foodCart!.restaurant!, style: Theme.of(context).textTheme.titleMedium),
              ...result.foodCart!.items.map((item) => Text('• ${item.name}')),
              if (result.foodCart!.total != null)
                Text('₹${result.foodCart!.total}', style: Theme.of(context).textTheme.titleMedium),
            ],
          ),
        if (result.instamartCartPreview != null && result.instamartCartPreview!.items.isNotEmpty)
          _Section(
            title: 'Instamart',
            children: [
              ...result.instamartCartPreview!.items.map((item) => Text('• ${item.name} — ₹${item.price}')),
              if (result.instamartCartPreview!.note != null)
                Text(result.instamartCartPreview!.note!, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: const [Icon(Icons.lock, size: 18), SizedBox(width: 8), Text('Checkout stays blocked')]),
                const SizedBox(height: 4),
                Text(
                  result.checkoutNote ??
                      'This is a preview only. Checkout stays blocked until a later final-confirmation flow.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _Section extends StatelessWidget {
  final String title;
  final List<Widget> children;
  const _Section({required this.title, required this.children});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [Text(title, style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: 6), ...children],
        ),
      ),
    );
  }
}
