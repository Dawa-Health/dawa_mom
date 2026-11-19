import 'dart:convert';
import 'dart:typed_data';

import 'package:dawa_mom/services/voice_service.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as supabase;

class VoiceTranscript {
  const VoiceTranscript({
    required this.transcript,
    required this.language,
    required this.valid,
    required this.voiceSupported,
    this.message,
  });

  final String transcript;
  final String language;
  final bool valid;
  final bool voiceSupported;
  final String? message;
}

Future<VoiceTranscript> transcribeVoiceNote({
  required Uint8List audioBytes,
  String? sessionId, // ignored server-side in transcribe-only mode
  String? language,
  bool languageLocked = true, // the user picked a language, so trust it
  double? durationSeconds,
  String edgeFunction = 'rudo-chat-medgemma', // was 'rudo-chat'
}) async {
  final response = await supabase.Supabase.instance.client.functions.invoke(
    edgeFunction,
    body: {
      if (sessionId != null && sessionId.isNotEmpty) 'session_id': sessionId,
      'audio_base64': base64Encode(audioBytes),
      'filename': VoiceService.recordingFilename,
      'mime_type': VoiceService.recordingMimeType,
      'transcribe_only': true,
      if (language != null && language.isNotEmpty) 'language': language,
      'language_locked': languageLocked,
      if (durationSeconds != null && durationSeconds > 0)
        'duration_seconds': durationSeconds,
    },
  ).timeout(const Duration(seconds: 60));

  final data = response.data;
  if (data is! Map) {
    throw StateError('$edgeFunction returned an unexpected response.');
  }

  final error = data['error'];
  if (error is String && error.isNotEmpty) {
    throw StateError(error);
  }

  final rawTranscript = data['transcript'];
  final transcript = rawTranscript is String ? rawTranscript.trim() : '';

  final rawMessage = data['message'] ?? data['reply'];
  final message = rawMessage is String && rawMessage.trim().isNotEmpty
      ? rawMessage.trim()
      : null;

  final rawLanguage = data['language'];

  return VoiceTranscript(
    transcript: transcript,
    language: rawLanguage is String && rawLanguage.isNotEmpty
        ? rawLanguage
        : (language ?? 'english'),
    valid: data['transcript_valid'] == true && transcript.isNotEmpty,
    voiceSupported: data['voice_supported'] != false,
    message: message,
  );
}