import 'dart:io';

import 'package:dawa_mom/features/terms/dawa_terms.dart';
import 'package:dawa_mom/features/terms/dawa_terms_consent.dart';
import 'package:dawa_mom/features/terms/dawa_terms_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  group('DawaTermsConsent', () {
    test('asks for agreement when nothing has been accepted', () async {
      SharedPreferences.setMockInitialValues({});
      final consent = await DawaTermsConsent.load();
      expect(consent.hasAcceptedCurrentTerms, isFalse);
      expect(consent.acceptedVersion, isNull);
    });

    test('remembers the accepted version and when it was accepted', () async {
      SharedPreferences.setMockInitialValues({});
      final consent = await DawaTermsConsent.load();
      await consent.accept(now: DateTime.utc(2026, 11, 20, 8));

      final reloaded = await DawaTermsConsent.load();
      expect(reloaded.hasAcceptedCurrentTerms, isTrue);
      expect(reloaded.acceptedVersion, DawaTerms.version);
      expect(reloaded.acceptedAt, DateTime.utc(2026, 11, 20, 8));
    });

    test('asks again after the terms change', () async {
      SharedPreferences.setMockInitialValues({
        DawaTermsConsent.acceptedVersionKey: DawaTerms.version - 1,
      });
      final consent = await DawaTermsConsent.load();
      expect(consent.hasAcceptedCurrentTerms, isFalse);
    });
  });

  group('DawaTermsPage', () {
    // Shown the way main.dart shows it: from MaterialApp.builder, above the
    // navigator, so nothing in it may need a navigator or overlay.
    Future<void> pumpAgreement(
      WidgetTester tester,
      Future<void> Function(bool modelTrainingOptIn) onAgree, {
      Size size = const Size(390, 844),
    }) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) =>
              DawaTermsPage.agreement(onAgree: onAgree),
          home: const SizedBox(),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('can only continue after ticking the box', (tester) async {
      var agreed = 0;
      await pumpAgreement(tester, (_) async {
        agreed++;
      });
      expect(tester.takeException(), isNull);

      final button = find.byKey(const ValueKey('terms-agree-button'));
      expect(tester.widget<FilledButton>(button).onPressed, isNull);

      await tester.tap(find.byKey(const ValueKey('terms-agree-checkbox')));
      await tester.pump();
      expect(tester.widget<FilledButton>(button).onPressed, isNotNull);

      await tester.tap(button);
      await tester.pumpAndSettle();
      expect(agreed, 1);
    });

    testWidgets('the training opt-in is optional and off by default',
        (tester) async {
      final choices = <bool>[];
      await pumpAgreement(tester, (optIn) async => choices.add(optIn));

      final optIn = find.byKey(const ValueKey('terms-training-opt-in-checkbox'));
      expect(tester.widget<CheckboxListTile>(optIn).value, isFalse);
      expect(find.text(DawaTerms.modelTrainingOptInTitle), findsOneWidget);

      // Agreeing without opting in is allowed, and records "no".
      await tester.tap(find.byKey(const ValueKey('terms-agree-checkbox')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('terms-agree-button')));
      await tester.pumpAndSettle();
      expect(choices, [false]);
    });

    testWidgets('ticking the opt-in passes it on', (tester) async {
      final choices = <bool>[];
      await pumpAgreement(tester, (optIn) async => choices.add(optIn));

      await tester.tap(
        find.byKey(const ValueKey('terms-training-opt-in-checkbox')),
      );
      await tester.tap(find.byKey(const ValueKey('terms-agree-checkbox')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('terms-agree-button')));
      await tester.pumpAndSettle();
      expect(choices, [true]);
    });

    testWidgets('shows the terms text as written', (tester) async {
      await pumpAgreement(tester, (_) async {});
      expect(find.text(DawaTerms.introduction), findsOneWidget);
      expect(find.text(DawaTerms.sections.first.heading), findsOneWidget);
    });

    testWidgets('fits a small phone with large text', (tester) async {
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await pumpAgreement(tester, (_) async {}, size: const Size(320, 568));
      expect(tester.takeException(), isNull);
      expect(
        find.byKey(const ValueKey('terms-agree-button')),
        findsOneWidget,
      );
    });

    testWidgets('view mode from Settings has no agreement controls',
        (tester) async {
      await tester.pumpWidget(
        const MaterialApp(home: DawaTermsPage.view()),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Terms and conditions'), findsOneWidget);
      expect(find.byKey(const ValueKey('terms-agree-checkbox')), findsNothing);
      expect(find.byKey(const ValueKey('terms-agree-button')), findsNothing);
    });
  });

  test('the app shows the terms after the splash, before any page', () {
    final main = File('lib/main.dart').readAsStringSync();
    expect(main, contains('DawaTermsConsent.load()'));
    expect(main, contains('DawaTermsPage.agreement(onAgree: _acceptTerms)'));
    expect(
      main.indexOf('if (_showSplash)'),
      lessThan(main.indexOf('if (_showTerms)')),
    );
  });
}
