import 'package:flutter/material.dart' as material;

import '/localization/dawa_localized_material.dart';
import '/design_system/dawa_components.dart';
import '/design_system/dawa_design_tokens.dart';
import '/features/terms/dawa_terms.dart';

/// The terms and conditions screen.
///
/// [DawaTermsPage.agreement] is shown after the splash screen until the
/// current terms are accepted. It sits above the app's navigator (see
/// `MyApp` in main.dart), so it cannot be dismissed or navigated around, and
/// it uses no widgets that need a navigator or overlay.
///
/// [DawaTermsPage.view] is the read-only version opened from Settings.
class DawaTermsPage extends StatefulWidget {
  const DawaTermsPage.agreement({
    super.key,
    required Future<void> Function(bool modelTrainingOptIn) this.onAgree,
  });

  const DawaTermsPage.view({super.key}) : onAgree = null;

  /// Saves the agreement, with the person's optional model-training choice,
  /// and lets her into the app. Null in view mode.
  final Future<void> Function(bool modelTrainingOptIn)? onAgree;

  bool get asksForAgreement => onAgree != null;

  @override
  State<DawaTermsPage> createState() => _DawaTermsPageState();
}

class _DawaTermsPageState extends State<DawaTermsPage> {
  final _scrollController = ScrollController();
  bool _agreed = false;
  // Optional, and off unless she ticks it. Not needed to continue.
  bool _trainingOptIn = false;
  bool _saving = false;

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _agree() async {
    final onAgree = widget.onAgree;
    if (onAgree == null || !_agreed || _saving) return;
    setState(() => _saving = true);
    try {
      await onAgree(_trainingOptIn);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final body = SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              DawaSpacing.lg,
              DawaSpacing.md,
              DawaSpacing.lg,
              DawaSpacing.md,
            ),
            child: LayoutBuilder(
              builder: (context, constraints) => Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(child: _termsCard(context)),
                  if (widget.asksForAgreement) ...[
                    const SizedBox(height: DawaSpacing.xs),
                    // The checkboxes scroll on their own if large text makes
                    // them taller than this, so the terms and the button
                    // always stay on screen.
                    ConstrainedBox(
                      constraints: BoxConstraints(
                        maxHeight: constraints.maxHeight * 0.4,
                      ),
                      child: SingleChildScrollView(
                        child: _agreementChoices(context),
                      ),
                    ),
                    const SizedBox(height: DawaSpacing.xs),
                    _agreeButton(),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );

    if (widget.asksForAgreement) {
      return Scaffold(backgroundColor: DawaColors.canvas, body: body);
    }
    return Scaffold(
      backgroundColor: DawaColors.canvas,
      appBar: AppBar(
        backgroundColor: DawaColors.canvas,
        title: Text('Terms and conditions', style: context.dawaTitle),
      ),
      body: body,
    );
  }

  Widget _header(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Semantics(
                header: true,
                child: Text('Terms and conditions', style: context.dawaTitle),
              ),
              const SizedBox(height: 3),
              Text(
                'Please read these terms and agree to them to use DawaMom.',
                style: context.dawaCaption,
              ),
            ],
          ),
        ),
        SizedBox(
          width: 72,
          height: 60,
          child: Image.asset(
            DawaArtwork.motherBabyLine,
            fit: BoxFit.contain,
            excludeFromSemantics: true,
          ),
        ),
      ],
    );
  }

  Widget _termsCard(BuildContext context) {
    // material.Text on purpose: the legal wording is shown exactly as written,
    // without the app's automatic phrase translation (see dawa_terms.dart).
    return DawaCard(
      padding: EdgeInsets.zero,
      child: Scrollbar(
        controller: _scrollController,
        thumbVisibility: true,
        child: SingleChildScrollView(
          controller: _scrollController,
          padding: const EdgeInsets.all(DawaSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Inside the scrolling card, so large text can never push the
              // checkboxes and button off a small screen.
              if (widget.asksForAgreement) ...[
                _header(context),
                const SizedBox(height: DawaSpacing.md),
              ],
              material.Text(
                'Version ${DawaTerms.version}, effective '
                '${DawaTerms.effectiveDate}',
                style: context.dawaCaption,
              ),
              const SizedBox(height: DawaSpacing.xs),
              material.Text(DawaTerms.introduction, style: context.dawaBody),
              for (final section in DawaTerms.sections) ...[
                const SizedBox(height: DawaSpacing.lg),
                Semantics(
                  header: true,
                  child: material.Text(
                    section.heading,
                    style: context.dawaSectionTitle,
                  ),
                ),
                for (final paragraph in section.paragraphs)
                  Padding(
                    padding: const EdgeInsets.only(top: DawaSpacing.xs),
                    child: material.Text(paragraph, style: context.dawaBody),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _agreementChoices(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        CheckboxListTile(
          key: const ValueKey('terms-agree-checkbox'),
          value: _agreed,
          onChanged: _saving
              ? null
              : (value) => setState(() => _agreed = value ?? false),
          controlAffinity: ListTileControlAffinity.leading,
          contentPadding: EdgeInsets.zero,
          activeColor: DawaColors.primary,
          title: Text(
            'I have read and agree to the terms and conditions.',
            style: context.dawaBody,
          ),
        ),
        CheckboxListTile(
          key: const ValueKey('terms-training-opt-in-checkbox'),
          value: _trainingOptIn,
          onChanged: _saving
              ? null
              : (value) => setState(() => _trainingOptIn = value ?? false),
          controlAffinity: ListTileControlAffinity.leading,
          contentPadding: EdgeInsets.zero,
          activeColor: DawaColors.primary,
          isThreeLine: true,
          // material.Text: consent wording is shown exactly as written.
          title: material.Text(
            DawaTerms.modelTrainingOptInTitle,
            style: context.dawaBody.copyWith(fontWeight: FontWeight.w600),
          ),
          subtitle: material.Text(
            DawaTerms.modelTrainingOptInDescription,
            style: context.dawaCaption,
          ),
        ),
      ],
    );
  }

  Widget _agreeButton() {
    return FilledButton(
      key: const ValueKey('terms-agree-button'),
      onPressed: _agreed && !_saving ? _agree : null,
      child: _saving
          ? const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Text('Agree and continue'),
    );
  }
}
