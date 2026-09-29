import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:moodish/core/models/recommendation_models.dart';
import 'package:moodish/features/personal/live_cart_review.dart';

Map<String, dynamic> review({bool canConfirm = true}) => {
      'preparationId': 'prep-1',
      'note': 'This will update your real Swiggy Food cart.',
      'address': {'id': 'addr-1', 'label': 'Home', 'display': 'Flat 1'},
      'items': [
        {'itemId': 'dish-1', 'name': 'Soya Chaap', 'quantity': 1, 'price': 250}
      ],
      'estimatedItemTotal': 250,
      'existingCart': {'restaurant': canConfirm ? '' : 'Other Kitchen', 'items': canConfirm ? [] : [{'itemId': 'x', 'name': 'X', 'quantity': 1}], 'total': 0},
      'replacesExistingCart': !canConfirm,
      'canConfirm': canConfirm,
      'blockedReason': canConfirm ? null : 'Your Swiggy Food cart already has items, and Swiggy adds to that cart instead of replacing it.',
    };

Future<String?> runReview(WidgetTester tester, Map<String, dynamic> response, {String? tap}) async {
  String? result = 'not-finished';
  final option = RecommendationOption.fromJson({'optionId': 'o1', 'restaurantName': 'Fake Chaap House', 'items': [], 'estimatedTotal': 250});
  await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) => TextButton(
    onPressed: () async { result = await reviewLiveCart(context, option, (_) async => response); },
    child: const Text('Review'),
  ))));
  await tester.tap(find.text('Review'));
  await tester.pumpAndSettle();
  if (tap != null) {
    await tester.tap(find.text(tap));
    await tester.pumpAndSettle();
  }
  return result;
}

void main() {
  testWidgets('a confirmable review shows the estimate and returns the preparation on confirm', (tester) async {
    final result = await runReview(tester, review(), tap: 'Update Food cart');
    expect(result, 'prep-1');
  });

  testWidgets('cancelling a review returns nothing', (tester) async {
    expect(await runReview(tester, review(), tap: 'Cancel'), isNull);
  });

  testWidgets('a blocked review explains why and offers no update button', (tester) async {
    String? result = 'not-finished';
    final option = RecommendationOption.fromJson({'optionId': 'o1', 'restaurantName': 'Fake Chaap House', 'items': [], 'estimatedTotal': 250});
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) => TextButton(
      onPressed: () async { result = await reviewLiveCart(context, option, (_) async => review(canConfirm: false)); },
      child: const Text('Review'),
    ))));
    await tester.tap(find.text('Review'));
    await tester.pumpAndSettle();
    expect(find.textContaining('adds to that cart instead of replacing it'), findsOneWidget);
    expect(find.textContaining('Items estimate (not the final bill)'), findsOneWidget);
    expect(find.text('Update Food cart'), findsNothing);
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(result, isNull);
  });
}
