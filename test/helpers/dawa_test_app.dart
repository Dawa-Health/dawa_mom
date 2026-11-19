import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

/// Name of the method behind a noSuchMethod [Invocation], e.g. "load".
String invocationName(Invocation invocation) =>
    invocation.memberName.toString().replaceAll(RegExp(r'Symbol\("|"\)'), '');

/// Pumps a few short frames so futures resolve and short animations finish,
/// without waiting for endless animations (shimmers, Lottie) to settle.
Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Shows [home] at "/" inside a GoRouter. Every path in [stubRoutes] becomes
/// a page that shows the text "STUB:<path>", so tests can check navigation
/// without building the real destination screens.
Future<void> pumpDawaScreen(
  WidgetTester tester,
  Widget home, {
  List<String> stubRoutes = const [],
  Size size = const Size(420, 2200),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  final router = GoRouter(
    routes: [
      GoRoute(path: '/', builder: (_, __) => home),
      for (final path in stubRoutes)
        GoRoute(
          path: path,
          builder: (_, __) => Scaffold(body: Text('STUB:$path')),
        ),
    ],
  );
  await tester.pumpWidget(MaterialApp.router(routerConfig: router));
  await settle(tester);
}

Future<void> tapText(WidgetTester tester, String text) async {
  final finder = find.text(text);
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await settle(tester);
}
