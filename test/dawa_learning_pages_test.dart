import 'package:dawa_mom/features/learning/data/dawa_learning_repository.dart';
import 'package:dawa_mom/features/learning/presentation/dawa_learning_detail_pages.dart';
import 'package:dawa_mom/features/learning/presentation/dawa_quest_pages.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'helpers/dawa_test_app.dart';

// Covers the pages that do not need a completion/saved-state change. Those
// flows (answering B, "Mark complete", "Save") build DawaLearningState with
// completedIds/savedIds, so they need dawa_learning_repository.dart to write
// safely.

class _FakeLearningRepository extends Fake implements DawaLearningRepository {
  _FakeLearningRepository([DawaLearningState? state])
      : state = state ?? const DawaLearningState();

  final DawaLearningState state;
  final calls = <String>[];

  @override
  dynamic noSuchMethod(Invocation invocation) {
    final name = invocationName(invocation);
    calls.add(name);
    if (name == 'load') return Future<DawaLearningState>.value(state);
    return super.noSuchMethod(invocation);
  }
}

void main() {
  group('DawaQuestHubPage', () {
    const routes = [
      '/learn/quests/screening',
      '/learn/rewards',
      '/encounters',
    ];

    testWidgets('renders the hub with empty progress', (tester) async {
      final repo = _FakeLearningRepository();
      await pumpDawaScreen(tester, DawaQuestHubPage(repository: repo),
          stubRoutes: routes);

      expect(find.text('Stories, lessons and small steps for your health.'),
          findsOneWidget);
      expect(find.text('Bana Chenjela is here to guide you'), findsOneWidget);
      expect(find.text('Screening Without Fear'), findsOneWidget);
      expect(find.text('Continue quest'), findsOneWidget);
      expect(find.text('0% complete'), findsOneWidget);
      expect(find.text('0 coins'), findsOneWidget);
      expect(find.text('My rewards'), findsOneWidget);
      expect(find.text('Book my screening'), findsOneWidget);
      expect(find.text('Women’s cohort'), findsOneWidget);
      expect(repo.calls, contains('load'));
    });

    testWidgets('shows the saved coin balance', (tester) async {
      final repo = _FakeLearningRepository(const DawaLearningState(coins: 120));
      await pumpDawaScreen(tester, DawaQuestHubPage(repository: repo),
          stubRoutes: routes);

      expect(find.text('120 coins'), findsOneWidget);
    });

    testWidgets('"Continue quest" opens the screening module', (tester) async {
      await pumpDawaScreen(
          tester, DawaQuestHubPage(repository: _FakeLearningRepository()),
          stubRoutes: routes);

      await tapText(tester, 'Continue quest');

      expect(find.text('STUB:/learn/quests/screening'), findsOneWidget);
    });

    testWidgets('"My rewards" opens the rewards page', (tester) async {
      await pumpDawaScreen(
          tester, DawaQuestHubPage(repository: _FakeLearningRepository()),
          stubRoutes: routes);

      await tapText(tester, 'My rewards');

      expect(find.text('STUB:/learn/rewards'), findsOneWidget);
    });

    testWidgets('"Book now" goes to encounters', (tester) async {
      await pumpDawaScreen(
          tester, DawaQuestHubPage(repository: _FakeLearningRepository()),
          stubRoutes: routes);

      await tapText(tester, 'Book now');

      expect(find.text('STUB:/encounters'), findsOneWidget);
    });

    testWidgets('"Keep going" opens the screening module', (tester) async {
      await pumpDawaScreen(
          tester, DawaQuestHubPage(repository: _FakeLearningRepository()),
          stubRoutes: routes);

      await tapText(tester, 'Keep going');

      expect(find.text('STUB:/learn/quests/screening'), findsOneWidget);
    });
  });

  group('DawaClinicLessonPage', () {
    const routes = ['/learn/quests/screening/checkpoint'];

    testWidgets('renders the three clinic steps and reassurance',
        (tester) async {
      await pumpDawaScreen(tester, const DawaClinicLessonPage(),
          stubRoutes: routes);

      expect(find.text('SCREENING GUIDE'), findsOneWidget);
      expect(find.text('Bana Chenjela says'), findsOneWidget);
      expect(find.text('What to expect at the clinic'), findsOneWidget);
      expect(find.text('Check in'), findsOneWidget);
      expect(find.text('Quick screening test'), findsOneWidget);
      expect(find.text('Get your next steps'), findsOneWidget);
      expect(find.textContaining('Tell them if you feel uncomfortable'),
          findsOneWidget);
    });

    testWidgets('"I understand" opens the checkpoint', (tester) async {
      await pumpDawaScreen(tester, const DawaClinicLessonPage(),
          stubRoutes: routes);

      await tapText(tester, 'I understand');

      expect(find.text('STUB:/learn/quests/screening/checkpoint'),
          findsOneWidget);
    });

    testWidgets('"I’m still worried" also opens the checkpoint',
        (tester) async {
      await pumpDawaScreen(tester, const DawaClinicLessonPage(),
          stubRoutes: routes);

      await tapText(tester, 'I’m still worried');

      expect(find.text('STUB:/learn/quests/screening/checkpoint'),
          findsOneWidget);
    });

    testWidgets('uses the stacked layout on a narrow screen', (tester) async {
      await pumpDawaScreen(tester, const DawaClinicLessonPage(),
          stubRoutes: routes, size: const Size(360, 2600));

      expect(find.text('Bana Chenjela says'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('DawaQuestCheckpointPage', () {
    const routes = ['/learn/quests/completed'];

    testWidgets('renders the question and both answers', (tester) async {
      await pumpDawaScreen(
          tester, DawaQuestCheckpointPage(repository: _FakeLearningRepository()),
          stubRoutes: routes);

      expect(find.text('Quest Checkpoint'), findsOneWidget);
      expect(find.text('Which statement is true?'), findsOneWidget);
      expect(find.text('Choose one answer.'), findsOneWidget);
      expect(find.byKey(const ValueKey('checkpoint-answer-a')), findsOneWidget);
      expect(find.byKey(const ValueKey('checkpoint-answer-b')), findsOneWidget);
    });

    testWidgets('a wrong answer explains why and saves nothing',
        (tester) async {
      final repo = _FakeLearningRepository();
      await pumpDawaScreen(tester, DawaQuestCheckpointPage(repository: repo),
          stubRoutes: routes);

      await tester.tap(find.byKey(const ValueKey('checkpoint-answer-a')));
      await settle(tester);

      expect(find.textContaining('Not quite'), findsOneWidget);
      expect(find.textContaining('Follow advice from a trained health worker'),
          findsOneWidget);
      // Only the initial load happened: nothing was completed or awarded.
      expect(repo.calls, ['load']);
    });

    testWidgets('"Continue quest" stays locked after a wrong answer',
        (tester) async {
      await pumpDawaScreen(
          tester, DawaQuestCheckpointPage(repository: _FakeLearningRepository()),
          stubRoutes: routes);

      await tester.tap(find.byKey(const ValueKey('checkpoint-answer-a')));
      await settle(tester);
      await tapText(tester, 'Continue quest');

      expect(find.text('STUB:/learn/quests/completed'), findsNothing);
    });

    testWidgets('tapping the same wrong answer twice does not fail',
        (tester) async {
      final repo = _FakeLearningRepository();
      await pumpDawaScreen(tester, DawaQuestCheckpointPage(repository: repo),
          stubRoutes: routes);

      final answer = find.byKey(const ValueKey('checkpoint-answer-a'));
      await tester.tap(answer);
      await settle(tester);
      await tester.tap(answer);
      await settle(tester);

      expect(find.textContaining('Not quite'), findsOneWidget);
      expect(repo.calls, ['load']);
    });
  });

  group('DawaArticlePage', () {
    const routes = [
      '/encounters',
      '/learn/quests/screening',
      '/learn/lesson/myth-vs-fact',
    ];

    testWidgets('renders every article section', (tester) async {
      await pumpDawaScreen(
          tester, DawaArticlePage(repository: _FakeLearningRepository()),
          stubRoutes: routes);

      expect(find.text('What is cervical cancer?'), findsOneWidget);
      expect(find.text('Warning signs'), findsOneWidget);
      expect(find.text('Who should ask about screening?'), findsOneWidget);
      expect(find.text('What happens during screening?'), findsOneWidget);
      expect(find.text('When to contact a health worker'), findsOneWidget);
      expect(find.text('Why it matters'), findsOneWidget);
      expect(find.text('Related learning'), findsOneWidget);
      expect(find.text('6 min read'), findsOneWidget);
      expect(find.text('Save article'), findsOneWidget);
    });

    testWidgets('"Find screening" goes to encounters', (tester) async {
      await pumpDawaScreen(
          tester, DawaArticlePage(repository: _FakeLearningRepository()),
          stubRoutes: routes);

      await tapText(tester, 'Find screening');

      expect(find.text('STUB:/encounters'), findsOneWidget);
    });

    testWidgets('"Start screening quest" opens the quest', (tester) async {
      await pumpDawaScreen(
          tester, DawaArticlePage(repository: _FakeLearningRepository()),
          stubRoutes: routes);

      await tapText(tester, 'Start screening quest');

      expect(find.text('STUB:/learn/quests/screening'), findsOneWidget);
    });

    testWidgets('the Myth vs Fact related card opens the lesson',
        (tester) async {
      await pumpDawaScreen(
          tester, DawaArticlePage(repository: _FakeLearningRepository()),
          stubRoutes: routes);

      await tapText(tester, 'Myth vs Fact');

      expect(find.text('STUB:/learn/lesson/myth-vs-fact'), findsOneWidget);
    });
  });

  group('DawaMythFactPage', () {
    testWidgets('renders the myth, the fact and the response buttons',
        (tester) async {
      await pumpDawaScreen(
          tester, DawaMythFactPage(repository: _FakeLearningRepository()));

      expect(find.text('SHORT LESSON'), findsOneWidget);
      expect(find.text('Myth'), findsOneWidget);
      expect(find.text('Fact'), findsOneWidget);
      expect(
          find.text(
              'If you eat certain slimy foods, labour will always be easier.'),
          findsOneWidget);
      expect(find.text('I’ve heard this'), findsOneWidget);
      expect(find.text('I didn’t know this'), findsOneWidget);
      expect(find.textContaining('Health worker tip'), findsOneWidget);
    });
  });
}
