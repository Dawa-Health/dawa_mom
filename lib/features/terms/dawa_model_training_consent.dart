import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '/features/terms/dawa_terms.dart';

/// A person's choice about letting Dawa Health use her data to train its AI
/// models. It is off unless she opts in. See "Model training data (opt-in)"
/// in the README for what this covers and how the training pipeline uses it.
class DawaModelTrainingChoice {
  const DawaModelTrainingChoice({
    required this.optedIn,
    required this.updatedAt,
    this.wordingVersion = DawaTerms.modelTrainingVersion,
  });

  // Keys in the account's Supabase auth user metadata
  // (auth.users.raw_user_meta_data). The training pipeline reads these.
  static const metadataOptInKey = 'model_training_opt_in';
  static const metadataUpdatedAtKey = 'model_training_opt_in_at';
  static const metadataVersionKey = 'model_training_consent_version';

  final bool optedIn;
  final DateTime updatedAt;

  /// Which wording of the opt-in she answered ([DawaTerms.modelTrainingVersion]).
  final int wordingVersion;

  Map<String, Object> toMetadata() => {
        metadataOptInKey: optedIn,
        metadataUpdatedAtKey: updatedAt.toUtc().toIso8601String(),
        metadataVersionKey: wordingVersion,
      };

  /// Null when the account has no recorded choice.
  static DawaModelTrainingChoice? fromMetadata(Map<String, dynamic>? data) {
    final optedIn = data?[metadataOptInKey];
    final updatedAt =
        DateTime.tryParse(data?[metadataUpdatedAtKey]?.toString() ?? '');
    if (optedIn is! bool || updatedAt == null) return null;
    final version = data?[metadataVersionKey];
    return DawaModelTrainingChoice(
      optedIn: optedIn,
      updatedAt: updatedAt,
      wordingVersion: version is int ? version : DawaTerms.modelTrainingVersion,
    );
  }
}

/// Where the choice is kept on the signed-in account.
abstract interface class DawaModelTrainingAccountStore {
  bool get isSignedIn;

  /// Null when signed out, or when the account has no recorded choice.
  Future<DawaModelTrainingChoice?> read();

  /// Returns false when signed out or when saving failed.
  Future<bool> write(DawaModelTrainingChoice choice);
}

/// Keeps the choice in the account's Supabase auth user metadata, so it
/// needs no database migration. A person can only change her own record.
class SupabaseModelTrainingAccountStore
    implements DawaModelTrainingAccountStore {
  const SupabaseModelTrainingAccountStore();

  SupabaseClient? get _client {
    try {
      return Supabase.instance.client;
    } catch (_) {
      return null;
    }
  }

  @override
  bool get isSignedIn => _client?.auth.currentUser != null;

  @override
  Future<DawaModelTrainingChoice?> read() async {
    final user = _client?.auth.currentUser;
    if (user == null) return null;
    return DawaModelTrainingChoice.fromMetadata(user.userMetadata);
  }

  @override
  Future<bool> write(DawaModelTrainingChoice choice) async {
    final client = _client;
    if (client?.auth.currentUser == null) return false;
    try {
      await client!.auth.updateUser(UserAttributes(data: choice.toMetadata()));
      return true;
    } catch (error) {
      debugPrint('[Training opt-in] Could not save to the account: $error');
      return false;
    }
  }
}

/// Saves the choice on the device straight away (the terms screen comes
/// before sign-in), and on the account whenever she is signed in. When the
/// two differ, the more recent choice wins.
class DawaModelTrainingConsent {
  DawaModelTrainingConsent({
    SharedPreferences? preferences,
    DawaModelTrainingAccountStore account =
        const SupabaseModelTrainingAccountStore(),
  })  : _preferences = preferences,
        _account = account;

  static const deviceOptInKey = 'dawa_model_training_opt_in';
  static const deviceUpdatedAtKey = 'dawa_model_training_opt_in_at';
  static const deviceVersionKey = 'dawa_model_training_consent_version';

  SharedPreferences? _preferences;
  final DawaModelTrainingAccountStore _account;

  Future<SharedPreferences> get _prefs async =>
      _preferences ??= await SharedPreferences.getInstance();

  /// The choice saved on this device, or null if none was made here.
  Future<DawaModelTrainingChoice?> deviceChoice() async {
    try {
      final prefs = await _prefs;
      final optedIn = prefs.getBool(deviceOptInKey);
      final updatedAt =
          DateTime.tryParse(prefs.getString(deviceUpdatedAtKey) ?? '');
      if (optedIn == null || updatedAt == null) return null;
      return DawaModelTrainingChoice(
        optedIn: optedIn,
        updatedAt: updatedAt,
        wordingVersion:
            prefs.getInt(deviceVersionKey) ?? DawaTerms.modelTrainingVersion,
      );
    } catch (error) {
      debugPrint('[Training opt-in] Could not read the device choice: $error');
      return null;
    }
  }

  /// Whether she is currently opted in: the newer of the device and account
  /// choices, and false when there is neither.
  Future<bool> isOptedIn() async {
    final device = await deviceChoice();
    final account = await _account.read();
    return _newer(device, account)?.optedIn ?? false;
  }

  /// Records a new choice now. Returns false if she is signed in but the
  /// account could not be updated; the next [syncWithAccount] retries.
  /// With [saveToAccount] false only the device is updated, and
  /// [syncWithAccount] copies it to the account later.
  Future<bool> setChoice(
    bool optedIn, {
    DateTime? now,
    bool saveToAccount = true,
  }) async {
    final choice = DawaModelTrainingChoice(
      optedIn: optedIn,
      updatedAt: (now ?? DateTime.now()).toUtc(),
    );
    await _saveOnDevice(choice);
    if (!saveToAccount || !_account.isSignedIn) return true;
    return _account.write(choice);
  }

  /// Run after sign-in: copies a newer device choice to the account (for
  /// example one made on the terms screen before signing in), or a newer
  /// account choice to the device.
  Future<void> syncWithAccount() async {
    if (!_account.isSignedIn) return;
    final device = await deviceChoice();
    final account = await _account.read();
    if (device == null && account == null) return;
    if (account == null ||
        (device != null && device.updatedAt.isAfter(account.updatedAt))) {
      await _account.write(device!);
    } else if (device == null || account.updatedAt.isAfter(device.updatedAt)) {
      await _saveOnDevice(account);
    }
  }

  Future<void> _saveOnDevice(DawaModelTrainingChoice choice) async {
    try {
      final prefs = await _prefs;
      await prefs.setBool(deviceOptInKey, choice.optedIn);
      await prefs.setString(
        deviceUpdatedAtKey,
        choice.updatedAt.toUtc().toIso8601String(),
      );
      await prefs.setInt(deviceVersionKey, choice.wordingVersion);
    } catch (error) {
      debugPrint('[Training opt-in] Could not save on the device: $error');
    }
  }

  static DawaModelTrainingChoice? _newer(
    DawaModelTrainingChoice? a,
    DawaModelTrainingChoice? b,
  ) {
    if (a == null) return b;
    if (b == null) return a;
    return b.updatedAt.isAfter(a.updatedAt) ? b : a;
  }
}
