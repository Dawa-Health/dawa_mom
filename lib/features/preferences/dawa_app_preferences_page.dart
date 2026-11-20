import 'package:flutter/material.dart' as material;
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '/design_system/dawa_components.dart';
import '/design_system/dawa_design_tokens.dart';
import '/design_system/dawa_page_scaffold.dart';
import '/localization/dawa_localized_material.dart';
import '/features/terms/dawa_model_training_consent.dart';
import '/features/terms/dawa_terms.dart';

import 'dawa_user_preferences_repository.dart';

/// Controls optional, non-clinical feedback used across DawaMom, and the
/// optional opt-in to model training.
///
/// The feedback settings are stored on the device. They do not need health
/// data or a network connection, so a user can change them even while
/// offline. The model-training choice is also saved on the account when
/// signed in (see dawa_model_training_consent.dart).
class DawaAppPreferencesPage extends StatefulWidget {
  const DawaAppPreferencesPage({
    super.key,
    this.repository,
    this.modelTraining,
  });

  static const routeName = 'AppPreferences';
  static const routePath = '/app-preferences';

  final DawaUserPreferencesRepository? repository;
  final DawaModelTrainingConsent? modelTraining;

  @override
  State<DawaAppPreferencesPage> createState() => _DawaAppPreferencesPageState();
}

class _DawaAppPreferencesPageState extends State<DawaAppPreferencesPage> {
  late final DawaUserPreferencesRepository _repository;
  DawaUserPreferences? _preferences;
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = widget.repository ?? DawaUserPreferencesRepository();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final preferences = await _repository.load();
      if (!mounted) return;
      setState(() {
        _preferences = preferences;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'App preferences could not be loaded. Please try again.';
      });
    }
  }

  Future<void> _save(DawaUserPreferences value) async {
    if (_saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final saved = await _repository.save(value);
      if (!mounted) return;
      setState(() {
        _preferences = saved;
        _saving = false;
      });
      if (saved.hapticFeedbackEnabled) {
        await HapticFeedback.selectionClick();
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('App preferences saved.')),
      );
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = 'Your app preferences could not be saved. Please try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) => DawaPageScaffold(
        maxWidth: 760,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            DawaAppHeader(title: 'App preferences', onBack: context.pop),
            const SizedBox(height: DawaSpacing.sm),
            if (_loading)
              const DawaLoadingSkeleton(
                lines: 4,
                label: 'Loading app preferences',
              )
            else if (_preferences == null)
              DawaErrorState(
                title: 'Preferences unavailable',
                message: _error ?? 'Your app preferences could not be loaded.',
                onRetry: _load,
              )
            else
              _buildPreferences(_preferences!),
          ],
        ),
      );

  Widget _buildPreferences(DawaUserPreferences value) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          DawaCard(
            color: DawaColors.softBlue,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const DawaIconBadge(
                  icon: Icons.tune_rounded,
                  color: DawaColors.primary,
                ),
                const SizedBox(width: DawaSpacing.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Make Dawa feel right for you',
                          style: context.dawaSectionTitle),
                      const SizedBox(height: DawaSpacing.xxs),
                      Text(
                        'These optional cues make completed actions clearer. Important messages always remain visible, even when they are off.',
                        style: context.dawaBody,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: DawaSpacing.md),
          const DawaSectionHeader(
            title: 'Feedback',
            subtitle: 'Choose the feedback you want after actions finish.',
          ),
          const SizedBox(height: DawaSpacing.xs),
          DawaCard(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Column(
              children: [
                _AppPreferenceSwitch(
                  icon: Icons.volume_up_outlined,
                  title: 'Sound effects',
                  subtitle: 'Play short sounds when actions finish.',
                  value: value.soundEffectsEnabled,
                  onChanged: _saving
                      ? null
                      : (enabled) => _save(
                            value.copyWith(soundEffectsEnabled: enabled),
                          ),
                ),
                _AppPreferenceSwitch(
                  icon: Icons.animation_outlined,
                  title: 'Animations',
                  subtitle:
                      'Show movement and celebrations when actions finish.',
                  value: !value.reducedAnimations,
                  onChanged: _saving
                      ? null
                      : (enabled) => _save(
                            value.copyWith(reducedAnimations: !enabled),
                          ),
                ),
                _AppPreferenceSwitch(
                  icon: Icons.vibration_rounded,
                  title: 'Vibration',
                  subtitle: 'Use gentle feedback after a confirmed action.',
                  value: value.hapticFeedbackEnabled,
                  onChanged: _saving
                      ? null
                      : (enabled) => _save(
                            value.copyWith(hapticFeedbackEnabled: enabled),
                          ),
                  showDivider: false,
                ),
              ],
            ),
          ),
          if (_saving) ...[
            const SizedBox(height: DawaSpacing.sm),
            const LinearProgressIndicator(),
          ],
          const SizedBox(height: DawaSpacing.md),
          const DawaSectionHeader(
            title: 'Your data',
            subtitle: 'Choose how Dawa Health may use your information.',
          ),
          const SizedBox(height: DawaSpacing.xs),
          DawaCard(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: _ModelTrainingPreference(
              consent: widget.modelTraining ?? DawaModelTrainingConsent(),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: DawaSpacing.sm),
            Semantics(
              liveRegion: true,
              child: Text(
                _error!,
                style: context.dawaBody.copyWith(color: DawaColors.danger),
              ),
            ),
          ],
        ],
      );
}

class _AppPreferenceSwitch extends StatelessWidget {
  const _AppPreferenceSwitch({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
    this.showDivider = true,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool>? onChanged;
  final bool showDivider;

  @override
  Widget build(BuildContext context) => Column(
        children: [
          SwitchListTile(
            secondary: Icon(icon, color: DawaColors.primary),
            title: Text(title, style: context.dawaSectionTitle),
            subtitle: Text(subtitle, style: context.dawaCaption),
            value: value,
            activeTrackColor: DawaColors.primary,
            onChanged: onChanged,
          ),
          if (showDivider) const Divider(height: 1),
        ],
      );
}

/// The optional opt-in to model training. Off unless she turns it on.
class _ModelTrainingPreference extends StatefulWidget {
  const _ModelTrainingPreference({required this.consent});

  final DawaModelTrainingConsent consent;

  @override
  State<_ModelTrainingPreference> createState() =>
      _ModelTrainingPreferenceState();
}

class _ModelTrainingPreferenceState extends State<_ModelTrainingPreference> {
  bool? _optedIn;
  bool _saving = false;
  String? _notice;

  @override
  void initState() {
    super.initState();
    widget.consent.isOptedIn().then((value) {
      if (mounted) setState(() => _optedIn = value);
    });
  }

  Future<void> _change(bool optedIn) async {
    setState(() {
      _saving = true;
      _optedIn = optedIn;
      _notice = null;
    });
    final savedToAccount = await widget.consent.setChoice(optedIn);
    if (!mounted) return;
    setState(() {
      _saving = false;
      _notice = savedToAccount
          ? null
          : 'Saved on this device. Your account will be updated the next '
              'time you sign in.';
    });
  }

  @override
  Widget build(BuildContext context) {
    final optedIn = _optedIn;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // material.Text: consent wording is shown exactly as written, the
        // same as on the terms screen.
        SwitchListTile(
          key: const ValueKey('model-training-opt-in-switch'),
          secondary: const Icon(
            Icons.model_training_rounded,
            color: DawaColors.primary,
          ),
          title: material.Text(
            DawaTerms.modelTrainingOptInTitle,
            style: context.dawaSectionTitle,
          ),
          subtitle: material.Text(
            DawaTerms.modelTrainingOptInDescription,
            style: context.dawaCaption,
          ),
          isThreeLine: true,
          value: optedIn ?? false,
          activeTrackColor: DawaColors.primary,
          onChanged: optedIn == null || _saving ? null : _change,
        ),
        if (_notice != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              DawaSpacing.md,
              0,
              DawaSpacing.md,
              DawaSpacing.sm,
            ),
            child: Text(_notice!, style: context.dawaCaption),
          ),
      ],
    );
  }
}
