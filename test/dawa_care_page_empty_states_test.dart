import 'package:dawa_mom/features/appointments/presentation/dawa_care_page.dart';
import 'package:flutter_test/flutter_test.dart';

import 'helpers/dawa_test_app.dart';

// DawaCarePage accepts initialAppointments / initialClinics / initialCareItems,
// so it never touches Supabase when they are provided. Empty lists exercise
// the three empty states and the tab switching. Populated states (appointment
// cards, clinic cards, filters, history groups) need the Appointment,
// ClinicOption and DawaCareItem constructors, so they are not covered here.

DawaCarePage _page({int initialSectionIndex = 0}) => DawaCarePage(
      initialAppointments: const [],
      initialClinics: const [],
      initialCareItems: const [],
      initialSectionIndex: initialSectionIndex,
    );

void main() {
  group('upcoming tab', () {
    testWidgets('shows the header, tabs and the "no visits" state',
        (tester) async {
      await pumpDawaScreen(tester, _page());

      expect(find.text('Visits, trusted clinics, and care history.'),
          findsOneWidget);
      expect(find.text('Upcoming'), findsOneWidget);
      expect(find.text('Clinics'), findsOneWidget);
      expect(find.text('History'), findsOneWidget);
      expect(find.text('No visits yet'), findsOneWidget);
      expect(find.text('Book a visit'), findsOneWidget);
      expect(find.text('Find clinics'), findsOneWidget);
    });

    testWidgets('"Find clinics" switches to the clinics tab', (tester) async {
      await pumpDawaScreen(tester, _page());

      await tapText(tester, 'Find clinics');

      expect(find.text('No booking clinics are available'), findsOneWidget);
      expect(find.text('No visits yet'), findsNothing);
    });
  });

  group('clinics tab', () {
    testWidgets('shows the empty clinics state', (tester) async {
      await pumpDawaScreen(tester, _page());

      await tapText(tester, 'Clinics');

      expect(find.text('No booking clinics are available'), findsOneWidget);
      expect(find.text('Refresh clinics'), findsOneWidget);
    });

    testWidgets('"Refresh clinics" keeps the page working', (tester) async {
      await pumpDawaScreen(tester, _page(initialSectionIndex: 1));

      await tapText(tester, 'Refresh clinics');

      expect(find.text('No booking clinics are available'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('history tab', () {
    testWidgets('shows the empty history state', (tester) async {
      await pumpDawaScreen(tester, _page());

      await tapText(tester, 'History');

      expect(find.text('No previous visits yet'), findsOneWidget);
      expect(find.textContaining('will remain here'), findsOneWidget);
      expect(find.text('Book appointment'), findsOneWidget);
    });

    testWidgets('can switch back to upcoming', (tester) async {
      await pumpDawaScreen(tester, _page());

      await tapText(tester, 'History');
      await tapText(tester, 'Upcoming');

      expect(find.text('No visits yet'), findsOneWidget);
      expect(find.text('No previous visits yet'), findsNothing);
    });
  });

  group('initialSectionIndex', () {
    testWidgets('1 starts on clinics', (tester) async {
      await pumpDawaScreen(tester, _page(initialSectionIndex: 1));
      expect(find.text('No booking clinics are available'), findsOneWidget);
    });

    testWidgets('2 starts on history', (tester) async {
      await pumpDawaScreen(tester, _page(initialSectionIndex: 2));
      expect(find.text('No previous visits yet'), findsOneWidget);
    });

    testWidgets('an index that is too high is clamped to history',
        (tester) async {
      await pumpDawaScreen(tester, _page(initialSectionIndex: 99));
      expect(find.text('No previous visits yet'), findsOneWidget);
    });

    testWidgets('a negative index is clamped to upcoming', (tester) async {
      await pumpDawaScreen(tester, _page(initialSectionIndex: -5));
      expect(find.text('No visits yet'), findsOneWidget);
    });
  });
}
