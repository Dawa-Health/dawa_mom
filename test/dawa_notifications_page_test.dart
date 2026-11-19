import 'package:dawa_mom/features/notifications/dawa_notifications_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'helpers/dawa_test_app.dart';

// Tests the page against a fake DawaNotificationsRepository. The repository's
// own load() logic (appointments, cycle, learning and reward notifications)
// is not covered here; it needs DawaUserPreferences to build a fake.

class _FakeNotificationsRepository extends Fake
    implements DawaNotificationsRepository {
  _FakeNotificationsRepository(this.items, {Set<String>? read})
      : read = read ?? <String>{};

  final List<DawaNotificationItem> items;
  final Set<String> read;
  bool failLoads = false;
  int loadCalls = 0;
  final markedRead = <String>[];
  List<String>? markedAll;

  @override
  Future<(List<DawaNotificationItem>, Set<String>)> load() async {
    loadCalls++;
    if (failLoads) throw StateError('offline');
    return (items, read);
  }

  @override
  Future<Set<String>> markRead(Set<String> read, String id) async {
    markedRead.add(id);
    return {...read, id};
  }

  @override
  Future<Set<String>> markAllRead(Set<String> read, Iterable<String> ids) async {
    markedAll = ids.toList();
    return {...read, ...ids};
  }
}

DawaNotificationItem _item(
  String id,
  DawaNotificationCategory category,
  String title, {
  Duration age = Duration.zero,
  String? route,
}) =>
    DawaNotificationItem(
      id: id,
      category: category,
      title: title,
      body: '$title body',
      createdAt: DateTime.now().subtract(age),
      icon: Icons.notifications_rounded,
      color: Colors.blue,
      route: route,
    );

List<DawaNotificationItem> _sampleItems() => [
      _item('learning-1', DawaNotificationCategory.learning,
          'Learning progress saved',
          age: const Duration(hours: 2), route: '/learn'),
      _item('appointment-1', DawaNotificationCategory.appointments,
          'Appointment confirmed',
          age: const Duration(days: 1)),
      _item('cycle-1', DawaNotificationCategory.cycle, 'Cycle update',
          age: const Duration(days: 5)),
    ];

const _routes = ['/learn', '/notification-preferences'];

void main() {
  group('with notifications', () {
    testWidgets('lists items grouped by day', (tester) async {
      final repo = _FakeNotificationsRepository(_sampleItems());
      await pumpDawaScreen(tester, DawaNotificationsPage(repository: repo),
          stubRoutes: _routes);

      expect(find.text('Your updates'), findsOneWidget);
      expect(find.text('Learning progress saved'), findsOneWidget);
      expect(find.text('Appointment confirmed'), findsOneWidget);
      expect(find.text('Cycle update'), findsOneWidget);
      expect(find.text('Today'), findsOneWidget);
      expect(find.text('Earlier'), findsOneWidget);
      // "Yesterday" is both a group header and a relative time.
      expect(find.text('Yesterday'), findsWidgets);
      expect(find.text('2 hr ago'), findsOneWidget);
      expect(find.text('Recent'), findsOneWidget);
      expect(find.text('End of recent updates'), findsOneWidget);
    });

    testWidgets('shows all category filters', (tester) async {
      final repo = _FakeNotificationsRepository(_sampleItems());
      await pumpDawaScreen(tester, DawaNotificationsPage(repository: repo),
          stubRoutes: _routes);

      for (final label in [
        'All',
        'Appointments',
        'Cycle',
        'Pregnancy',
        'Check-ins',
        'Learning',
        'Rewards',
        'System',
      ]) {
        expect(find.widgetWithText(ChoiceChip, label), findsOneWidget,
            reason: label);
      }
    });

    testWidgets('a filter shows only its category', (tester) async {
      final repo = _FakeNotificationsRepository(_sampleItems());
      await pumpDawaScreen(tester, DawaNotificationsPage(repository: repo),
          stubRoutes: _routes);

      await tester.tap(find.widgetWithText(ChoiceChip, 'Cycle'));
      await settle(tester);

      expect(find.text('Cycle update'), findsOneWidget);
      expect(find.text('Learning progress saved'), findsNothing);
      expect(find.text('Appointment confirmed'), findsNothing);
    });

    testWidgets('a category with no items shows the empty message',
        (tester) async {
      final repo = _FakeNotificationsRepository(_sampleItems());
      await pumpDawaScreen(tester, DawaNotificationsPage(repository: repo),
          stubRoutes: _routes);

      await tester.tap(find.widgetWithText(ChoiceChip, 'System'));
      await settle(tester);

      expect(find.text('No updates'), findsOneWidget);
      expect(find.text('You’re all caught up for now.'), findsOneWidget);
      expect(find.text('There are no updates in this category.'),
          findsOneWidget);
    });

    testWidgets('"All" restores the full list', (tester) async {
      final repo = _FakeNotificationsRepository(_sampleItems());
      await pumpDawaScreen(tester, DawaNotificationsPage(repository: repo),
          stubRoutes: _routes);

      await tester.tap(find.widgetWithText(ChoiceChip, 'Cycle'));
      await settle(tester);
      await tester.tap(find.widgetWithText(ChoiceChip, 'All'));
      await settle(tester);

      expect(find.text('Learning progress saved'), findsOneWidget);
      expect(find.text('Cycle update'), findsOneWidget);
    });
  });

  group('reading notifications', () {
    testWidgets('tapping an item marks it read and opens its route',
        (tester) async {
      final repo = _FakeNotificationsRepository(_sampleItems());
      await pumpDawaScreen(tester, DawaNotificationsPage(repository: repo),
          stubRoutes: _routes);

      await tapText(tester, 'Learning progress saved');

      expect(repo.markedRead, ['learning-1']);
      expect(find.text('STUB:/learn'), findsOneWidget);
    });

    testWidgets('an item without a route is only marked read',
        (tester) async {
      final repo = _FakeNotificationsRepository(_sampleItems());
      await pumpDawaScreen(tester, DawaNotificationsPage(repository: repo),
          stubRoutes: _routes);

      await tapText(tester, 'Appointment confirmed');

      expect(repo.markedRead, ['appointment-1']);
      expect(find.text('Appointment confirmed'), findsOneWidget);
      expect(find.textContaining('STUB:'), findsNothing);
    });

    testWidgets('"Mark all as read" marks every item and then disappears',
        (tester) async {
      final repo = _FakeNotificationsRepository(_sampleItems());
      await pumpDawaScreen(tester, DawaNotificationsPage(repository: repo),
          stubRoutes: _routes);

      expect(find.text('Mark all as read'), findsOneWidget);
      await tapText(tester, 'Mark all as read');

      expect(repo.markedAll,
          unorderedEquals(['learning-1', 'appointment-1', 'cycle-1']));
      expect(find.text('Mark all as read'), findsNothing);
    });

    testWidgets('no "Mark all as read" when everything is already read',
        (tester) async {
      final items = _sampleItems();
      final repo = _FakeNotificationsRepository(items,
          read: items.map((item) => item.id).toSet());
      await pumpDawaScreen(tester, DawaNotificationsPage(repository: repo),
          stubRoutes: _routes);

      expect(find.text('Mark all as read'), findsNothing);
    });
  });

  group('empty and error states', () {
    testWidgets('no notifications shows the caught-up message',
        (tester) async {
      final repo = _FakeNotificationsRepository(const []);
      await pumpDawaScreen(tester, DawaNotificationsPage(repository: repo),
          stubRoutes: _routes);

      expect(find.text('No updates'), findsOneWidget);
      expect(find.text('You’re all caught up for now.'), findsOneWidget);
      expect(find.text('Mark all as read'), findsNothing);
    });

    testWidgets('a failed load shows an error and Retry recovers',
        (tester) async {
      final repo = _FakeNotificationsRepository(_sampleItems())
        ..failLoads = true;
      await pumpDawaScreen(tester, DawaNotificationsPage(repository: repo),
          stubRoutes: _routes);

      expect(find.text('Notifications could not be loaded'), findsOneWidget);
      expect(find.text('Cycle update'), findsNothing);

      repo.failLoads = false;
      await tapText(tester, 'Retry');

      expect(find.text('Notifications could not be loaded'), findsNothing);
      expect(find.text('Cycle update'), findsOneWidget);
    });
  });

  group('refreshing', () {
    testWidgets('reloads when the notifications change signal fires',
        (tester) async {
      final repo = _FakeNotificationsRepository(_sampleItems());
      await pumpDawaScreen(tester, DawaNotificationsPage(repository: repo),
          stubRoutes: _routes);
      expect(repo.loadCalls, 1);

      DawaNotificationsRepository.changes.value += 1;
      await settle(tester);

      expect(repo.loadCalls, 2);
    });

    testWidgets('"Preferences" opens the preferences route', (tester) async {
      final repo = _FakeNotificationsRepository(_sampleItems());
      await pumpDawaScreen(tester, DawaNotificationsPage(repository: repo),
          stubRoutes: _routes);

      await tapText(tester, 'Preferences');

      expect(find.text('STUB:/notification-preferences'), findsOneWidget);
    });
  });
}
