import 'dart:io';

import 'package:dawa_mom/features/terms/dawa_model_training_consent.dart';
import 'package:dawa_mom/features/terms/dawa_terms.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Stands in for the account's Supabase user metadata.
class _FakeAccount implements DawaModelTrainingAccountStore {
  _FakeAccount({this.isSignedIn = false, this.choice, this.failWrites = false});

  @override
  bool isSignedIn;
  DawaModelTrainingChoice? choice;
  bool failWrites;
  int writes = 0;

  @override
  Future<DawaModelTrainingChoice?> read() async => isSignedIn ? choice : null;

  @override
  Future<bool> write(DawaModelTrainingChoice choice) async {
    if (!isSignedIn || failWrites) return false;
    writes++;
    this.choice = DawaModelTrainingChoice.fromMetadata(choice.toMetadata());
    return true;
  }
}

void main() {
  final earlier = DateTime.utc(2026, 11, 1);
  final later = DateTime.utc(2026, 11, 20);

  late SharedPreferences preferences;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    preferences = await SharedPreferences.getInstance();
  });

  DawaModelTrainingConsent consentWith(_FakeAccount account) =>
      DawaModelTrainingConsent(preferences: preferences, account: account);

  test('is off until she opts in', () async {
    final consent = consentWith(_FakeAccount());
    expect(await consent.isOptedIn(), isFalse);
    expect(await consent.deviceChoice(), isNull);
  });

  test('a choice made before sign-in is kept on the device only', () async {
    final account = _FakeAccount();
    final consent = consentWith(account);

    expect(await consent.setChoice(true, now: later), isTrue);
    expect(await consent.isOptedIn(), isTrue);
    expect(account.writes, 0);

    final device = await consent.deviceChoice();
    expect(device?.optedIn, isTrue);
    expect(device?.updatedAt, later);
    expect(device?.wordingVersion, DawaTerms.modelTrainingVersion);
  });

  test('a choice made while signed in is saved on the account too', () async {
    final account = _FakeAccount(isSignedIn: true);
    final consent = consentWith(account);

    expect(await consent.setChoice(true, now: later), isTrue);
    expect(account.choice?.optedIn, isTrue);
    expect(account.choice?.updatedAt, later);
  });

  test('reports when the account could not be updated', () async {
    final account = _FakeAccount(isSignedIn: true, failWrites: true);
    final consent = consentWith(account);

    expect(await consent.setChoice(true, now: later), isFalse);
    // Still recorded on the device, for the next sync to retry.
    expect((await consent.deviceChoice())?.optedIn, isTrue);
  });

  test('saveToAccount: false leaves the account for the later sync', () async {
    final account = _FakeAccount(isSignedIn: true);
    final consent = consentWith(account);

    await consent.setChoice(true, now: later, saveToAccount: false);
    expect(account.writes, 0);

    await consent.syncWithAccount();
    expect(account.choice?.optedIn, isTrue);
  });

  group('syncWithAccount after sign-in', () {
    test('copies a newer device choice to the account', () async {
      final account = _FakeAccount(
        isSignedIn: true,
        choice: DawaModelTrainingChoice(optedIn: true, updatedAt: earlier),
      );
      final consent = consentWith(account);
      await consent.setChoice(false, now: later, saveToAccount: false);

      await consent.syncWithAccount();
      expect(account.choice?.optedIn, isFalse);
      expect(account.choice?.updatedAt, later);
    });

    test('copies a newer account choice to the device', () async {
      final account = _FakeAccount(
        isSignedIn: true,
        choice: DawaModelTrainingChoice(optedIn: true, updatedAt: later),
      );
      final consent = consentWith(account);
      await consent.setChoice(false, now: earlier, saveToAccount: false);

      await consent.syncWithAccount();
      expect((await consent.deviceChoice())?.optedIn, isTrue);
      expect(account.writes, 0);
    });

    test('does nothing when signed out or already in step', () async {
      final signedOut = _FakeAccount();
      final consent = consentWith(signedOut);
      await consent.setChoice(true, now: later);
      await consent.syncWithAccount();
      expect(signedOut.writes, 0);

      final inStep = _FakeAccount(
        isSignedIn: true,
        choice: DawaModelTrainingChoice(optedIn: true, updatedAt: later),
      );
      await consentWith(inStep).syncWithAccount();
      expect(inStep.writes, 0);
    });
  });

  test('isOptedIn uses the more recent of the device and account', () async {
    final account = _FakeAccount(
      isSignedIn: true,
      choice: DawaModelTrainingChoice(optedIn: false, updatedAt: later),
    );
    final consent = consentWith(account);
    await consent.setChoice(true, now: earlier, saveToAccount: false);
    expect(await consent.isOptedIn(), isFalse);
  });

  test('account metadata uses the keys the README documents', () {
    final metadata =
        DawaModelTrainingChoice(optedIn: true, updatedAt: later).toMetadata();
    expect(metadata, {
      'model_training_opt_in': true,
      'model_training_opt_in_at': '2026-11-20T00:00:00.000Z',
      'model_training_consent_version': DawaTerms.modelTrainingVersion,
    });

    final readme = File('README.md').readAsStringSync();
    for (final key in metadata.keys) {
      expect(readme, contains(key), reason: 'README must document $key');
    }
  });

  test('ignores missing or malformed account metadata', () {
    expect(DawaModelTrainingChoice.fromMetadata(null), isNull);
    expect(DawaModelTrainingChoice.fromMetadata({}), isNull);
    expect(
      DawaModelTrainingChoice.fromMetadata({
        'model_training_opt_in': 'yes',
        'model_training_opt_in_at': '2026-11-20T00:00:00.000Z',
      }),
      isNull,
    );
  });
}
