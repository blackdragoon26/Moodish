import 'package:flutter/material.dart';
import '../../core/models/recommendation_models.dart';

Future<String?> reviewLiveCart(BuildContext context, RecommendationOption option,
    Future<Map<String, dynamic>> Function(String?) prepare) async {
  String? restaurantId;
  if (option.foodSources.length > 1) {
    restaurantId = await showDialog<String>(context: context, builder: (dialogContext) => SimpleDialog(
      title: const Text('Choose one restaurant cart'),
      children: [const Padding(padding: EdgeInsets.all(16), child: Text('Other restaurant plans remain previews.')),
        ...option.foodSources.map((s) => SimpleDialogOption(onPressed: () => Navigator.pop(dialogContext, s.restaurantId), child: Text(s.restaurantName)))],
    ));
    if (restaurantId == null || !context.mounted) return null;
  }
  final review = await prepare(restaurantId);
  if (!context.mounted) return null;
  final address = review['address'] as Map<String, dynamic>;
  final items = review['items'] as List;
  final existing = review['existingCart'] as Map<String, dynamic>;
  final summary = [review['note'], 'Deliver to: ${address['label']} · ${address['display']}',
    ...items.map((i) => "${i['quantity']} × ${i['name']} · ₹${i['price']}"),
    "Items estimate: ₹${review['estimatedItemTotal']}",
    if (review['replacesExistingCart'] == true) "Existing cart: ${existing['restaurant']} · ₹${existing['total']}. This update can replace those contents.",
  ].join('\n\n');
  final confirmed = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
    title: const Text('Review Food cart'), content: SingleChildScrollView(child: Text(summary)),
    actions: [TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')),
      FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Update Food cart'))],
  ));
  return confirmed == true ? review['preparationId'] as String : null;
}
