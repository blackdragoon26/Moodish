import 'package:flutter_test/flutter_test.dart';

import 'package:moodish/main.dart';

void main() {
  testWidgets('App boots to the connecting state', (WidgetTester tester) async {
    await tester.pumpWidget(const MoodishApp());
    expect(find.byType(MoodishApp), findsOneWidget);
  });
}
