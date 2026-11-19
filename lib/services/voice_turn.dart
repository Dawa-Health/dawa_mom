import 'package:flutter/widgets.dart';

import 'package:dawa_mom/rudo_voice_transcription.dart';
import 'package:dawa_mom/services/voice_service.dart';
import 'package:dawa_mom/widgets/confirm_transcript_sheet.dart';

/// One full voice turn: stop recording -> transcribe -> user edits -> send -> speak.
/// Nothing reaches the chat model until the user taps Send.
Future<void> runVoiceTurn({
  required BuildContext context,
  required VoiceService voice,
  required String language,
  required double? durationSeconds,

  /// Sends the confirmed text to rudo-chat-medgemma as a normal `message`
  /// (with a fresh client_message_id) and returns the reply text.
  required Future<String> Function(String text, String language) sendMessage,

  /// Pause / resume your hands-free recording loop and silence detection.
  required Future<void> Function() pauseLoop,
  required Future<void> Function() resumeLoop,

  /// Update your "Listening / Transcribing / Speaking" label, or show an error.
  required void Function(String status) onStatus,
}) async {
  final bytes = await voice.stopRecording();
  if (bytes == null) {
    await resumeLoop();
    return;
  }

  onStatus('Transcribing...');
  VoiceTranscript t;
  try {
    t = await transcribeVoiceNote(
      audioBytes: bytes,
      language: language,
      languageLocked: true,
      durationSeconds: durationSeconds,
    );
  } catch (e) {
    onStatus('I couldn’t transcribe that. Please try again or type your message.');
    await resumeLoop();
    return;
  }

  if (!t.voiceSupported || !t.valid) {
    onStatus(t.message ?? 'I couldn’t hear that clearly. Please try again.');
    // Unsupported language: stay paused so the user can type instead.
    if (t.voiceSupported) await resumeLoop();
    return;
  }

  // Stop auto-listening so it doesn't record the sheet or the spoken reply.
  await pauseLoop();
  if (!context.mounted) return;

  final decision = await confirmTranscript(context, t.transcript);
  switch (decision.action) {
    case TranscriptAction.cancel:
    case TranscriptAction.rerecord:
      await resumeLoop();
      return;
    case TranscriptAction.send:
      break;
  }

  onStatus('Thinking...');
  try {
    final reply = await sendMessage(decision.text, t.language);
    onStatus('Speaking...');
    await voice.speakText(reply, t.language);
  } catch (e) {
    onStatus('Something went wrong. Please try again.');
  }
  await resumeLoop();
}