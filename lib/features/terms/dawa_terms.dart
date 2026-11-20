/// DawaMom's terms and conditions, shown after the splash screen until they
/// are accepted, and from Settings at any time.
///
/// DRAFT: written from what the app actually does. Have it reviewed by a
/// lawyer (including the age, liability and data-protection wording, and
/// which country's law applies) before release.
///
/// To change the terms: edit the text, raise [DawaTerms.version] by one and
/// update [DawaTerms.effectiveDate]. Everyone who agreed to an older version
/// is asked to agree again the next time they open the app.
///
/// The text is shown exactly as written here, without the app's automatic
/// word-by-word translation, so the legal wording is never mixed. Add proper,
/// reviewed translations before showing it in other languages.
abstract final class DawaTerms {
  static const version = 1;
  static const effectiveDate = '30 April 2026';

  /// Version of the model-training opt-in wording below. It is stored with
  /// each person's choice, so the training pipeline knows what she agreed to.
  /// Raise it when [modelTrainingOptInDescription] or section 9 changes.
  static const modelTrainingVersion = 1;

  /// The optional checkbox on the terms screen, and the switch in Settings.
  static const modelTrainingOptInTitle = 'Opt in: help train our AI (optional)';
  static const modelTrainingOptInDescription =
      'Let Dawa Health use your Rudo conversations and the health information '
      'you add to DawaMom, without your name or contact details, to train and '
      'improve its AI. You can use DawaMom fully without this, and you can '
      'change it at any time in Settings.';

  static const introduction =
      'These terms explain how you can use DawaMom, an app from Dawa Health. '
      'Please read them carefully. By tapping "Agree and continue", you '
      'accept them.';

  static const sections = <DawaTermsSection>[
    DawaTermsSection('1. About DawaMom', [
      'DawaMom helps you follow your pregnancy or cycle, learn about your '
          'health, book visits with clinics, and ask Rudo, our health '
          'assistant, your questions. DawaMom is provided by Dawa Health.',
    ]),
    DawaTermsSection('2. Health information, not medical care', [
      'DawaMom and Rudo give general health information. They do not '
          'diagnose or treat you, and they do not replace a doctor, nurse, '
          'midwife or other health worker.',
      'Always ask a health worker about your own health, and before you '
          'start, stop or change any medicine or treatment.',
    ]),
    DawaTermsSection('3. In an emergency', [
      'DawaMom is not an emergency service. If you have heavy bleeding, fits, '
          'a severe headache with blurred vision, a high fever, severe pain in '
          'your belly, or your baby is moving less than usual, go to the '
          'nearest clinic or hospital straight away or call your local '
          'emergency number. Do not wait for a reply from Rudo.',
    ]),
    DawaTermsSection('4. Rudo and artificial intelligence', [
      'Rudo uses artificial intelligence (AI) to answer questions. AI can make '
          'mistakes. Answers in languages other than English are translated '
          'by machine, so they may not always be exact.',
      'Check important information with a health worker, and do not rely on '
          'Rudo alone for decisions about your health or your baby\'s health.',
    ]),
    DawaTermsSection('5. Your account', [
      'Keep your sign-in details private. You are responsible for what is '
          'done with your account.',
      'Please give accurate information in your health profile, because the '
          'guidance you see depends on it.',
      'If you are under 18, use DawaMom with the help of a parent, guardian '
          'or health worker.',
    ]),
    DawaTermsSection('6. Appointments and payments', [
      'When you book a visit, DawaMom shares your booking, and the details '
          'needed for your care, with the clinic or health worker you choose. '
          'Care is provided by that clinic or health worker. Clinics may '
          'accept, change or cancel bookings.',
      'Some services must be paid for with Mobile Money. Payments are handled '
          'by our payment provider, Lipila. A booking that needs payment is '
          'only confirmed once the payment succeeds. If something goes wrong '
          'with a payment, contact us through Help & support.',
    ]),
    DawaTermsSection('7. Points and rewards', [
      'You can earn points for learning and using DawaMom. Points have no cash '
          'value and cannot be exchanged for money. We may change how points '
          'and rewards work, and rewards are only available where we say so.',
    ]),
    DawaTermsSection('8. Your information', [
      'To run DawaMom, we store the information you give us, such as your '
          'name, contact details, health profile, pregnancy and cycle '
          'information, appointments, payments, and your messages to Rudo, '
          'including the text of your voice notes. The recordings themselves '
          'are not kept.',
      'We use it to provide DawaMom, to tailor your guidance, to book and '
          'manage your care, and to keep the service safe and working.',
      'We share it only as needed: with the clinic or health worker you book '
          'with; with companies that help us run DawaMom, including our '
          'hosting and database provider, the AI, translation and voice '
          'services that power Rudo, and our payment provider; and when the '
          'law requires it. We do not sell your information.',
      'You can update your profile in the app, and you can delete your '
          'account at any time from Settings. Some records may be kept for a '
          'limited time where the law requires it.',
    ]),
    DawaTermsSection('9. Helping train our AI (optional)', [
      'You can choose to let Dawa Health use your conversations with Rudo and '
          'the health information you add to DawaMom, such as pregnancy and '
          'cycle details, to train and improve its AI models. This is off '
          'unless you opt in, and saying no does not change how you can use '
          'DawaMom.',
      'If you opt in, we remove your name, phone number, address and other '
          'contact details before using this information for training. '
          'Recordings of your voice notes are not kept, so they are never '
          'used.',
      'You can change your choice at any time in Settings, under App '
          'preferences. If you opt out, we stop using your information for '
          'new training. Information already used to train a model cannot '
          'always be removed from that model.',
    ]),
    DawaTermsSection('10. Using DawaMom fairly', [
      'Do not try to access other people\'s information, interfere with the '
          'service, or use DawaMom for anything unlawful or harmful.',
    ]),
    DawaTermsSection('11. Open source', [
      'The DawaMom source code is free software, released under the GNU '
          'Affero General Public License version 3. These terms cover your use '
          'of the DawaMom service. The licence covers the code.',
    ]),
    DawaTermsSection('12. Availability and changes', [
      'We work to keep DawaMom available and accurate, but we cannot promise '
          'that it will always work without interruptions or errors. We may '
          'change or stop features.',
      'As far as the law allows, Dawa Health is not responsible for loss or '
          'harm caused by relying on information in DawaMom instead of advice '
          'from a health worker.',
      'If we change these terms in a way that matters, we will ask you to '
          'read and agree to them again.',
    ]),
    DawaTermsSection('13. Contact us', [
      'If you have questions about these terms or your information, contact '
          'us through Help & support in the app, or visit dawa-health.com.',
    ]),
  ];
}

class DawaTermsSection {
  const DawaTermsSection(this.heading, this.paragraphs);

  final String heading;
  final List<String> paragraphs;
}
