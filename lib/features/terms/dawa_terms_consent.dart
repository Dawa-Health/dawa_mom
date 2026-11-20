import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '/features/terms/dawa_terms.dart';

/// Remembers on this device which version of the terms was accepted, and
/// when. The terms screen appears before sign-in, so agreement is kept per
/// device rather than per account.
class DawaTermsConsent {
  DawaTermsConsent(this._preferences);

  static const acceptedVersionKey = 'dawa_terms_accepted_version';
  static const acceptedAtKey = 'dawa_terms_accepted_at';

  // Null when saved settings could not be opened. The terms are then shown,
  // and accept() tries to open them again.
  SharedPreferences? _preferences;

  /// Never throws: if saved settings cannot be read, the terms are shown.
  static Future<DawaTermsConsent> load() async {
    try {
      return DawaTermsConsent(await SharedPreferences.getInstance());
    } catch (error) {
      debugPrint('[Terms] Could not read saved agreement: $error');
      return DawaTermsConsent(null);
    }
  }

  int? get acceptedVersion => _preferences?.getInt(acceptedVersionKey);

  DateTime? get acceptedAt =>
      DateTime.tryParse(_preferences?.getString(acceptedAtKey) ?? '');

  /// True once the current version (or a later one) has been accepted. When
  /// [DawaTerms.version] goes up, this turns false again.
  bool get hasAcceptedCurrentTerms =>
      (acceptedVersion ?? 0) >= DawaTerms.version;

  /// Records agreement to the current terms. A failure to save is logged
  /// rather than thrown: the person has agreed, so they continue, and they
  /// are asked again next time.
  Future<void> accept({DateTime? now}) async {
    try {
      final preferences =
          _preferences ??= await SharedPreferences.getInstance();
      await preferences.setInt(acceptedVersionKey, DawaTerms.version);
      await preferences.setString(
        acceptedAtKey,
        (now ?? DateTime.now()).toUtc().toIso8601String(),
      );
    } catch (error) {
      debugPrint('[Terms] Could not save agreement: $error');
    }
  }
}
