import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as supabase;

import 'package:dawa_mom/services/speech_chunks.dart';

// NOTE: requires the `record` package (pubspec.yaml has record: ^6.2.1).
// speech_to_text never exposes raw audio bytes, only recognized text, so it
// can't feed server-side STT.
//
// WEB NOTES:
// - Browsers have no filesystem, so path_provider's getTemporaryDirectory()
//   throws MissingPluginException on web. Every call to it is guarded by
//   kIsWeb below.
// - On web, `record` returns a blob: URL from stop() instead of a file path,
//   and AAC is not supported, so we record WAV there.
// - The recording on web is WAV, so every upload to the rudo-chat edge
//   function MUST use `VoiceService.recordingMimeType` and
//   `VoiceService.recordingExtension` for the MIME type and filename. Sending
//   a hardcoded 'audio/mp4' / '.m4a' for WAV audio makes Mansa decode the
//   bytes as AAC and return garbage (e.g. Arabic script for Shona speech).

class VoiceService {
  VoiceService({
    AudioPlayer? audioPlayer,
    FlutterTts? fallbackTts,
    AudioRecorder? recorder,
  })  : _audioPlayer = audioPlayer,
        _fallbackTts = fallbackTts,
        _recorder = recorder ?? AudioRecorder();

  static const String ttsProvider = String.fromEnvironment('TTS_PROVIDER');

  // Name of the deployed TTS edge function. It now runs Mansa TTS (the old
  // Sahara code was replaced), but the build-time define keeps its old name
  // so existing build configs still work. If you deployed the Mansa function
  // under a new name (e.g. 'mansa-tts'), build with
  //   --dart-define=SAHARA_TTS_EDGE_FUNCTION=mansa-tts
  static const String saharaTtsEdgeFunction = String.fromEnvironment(
    'SAHARA_TTS_EDGE_FUNCTION',
    defaultValue: 'tts',
  );

  static const String omnivoiceApiUrl =
      String.fromEnvironment('OMNIVOICE_API_URL');
  static const String omnivoiceApiKey =
      String.fromEnvironment('OMNIVOICE_API_KEY');

  /// Languages the Mansa TTS edge function can speak. Tonga and Lozi have no
  /// Mansa voice, so they (and anything unknown) go straight to device TTS.
  static const Set<String> mansaTtsLanguages = {
    'english',
    'shona',
    'bemba',
    'chinyanja',
    'ndebele',
  };

  /// Sample rate and channel count for recorded speech. 16 kHz mono is what
  /// speech models expect, and it makes a WAV about 5.5x smaller than the
  /// 44.1 kHz stereo default (roughly 32 KB/s instead of 176 KB/s).
  static const int recordingSampleRate = 16000;
  static const int recordingChannels = 1;

  /// Recordings smaller than this contain no speech (a bare WAV header is 44
  /// bytes), so [stopRecording] returns null for them.
  static const int minRecordingBytes = 2000;

  /// MIME type of audio returned by [stopRecording]. Use this (and the
  /// matching file extension) when uploading the bytes.
  static String get recordingMimeType => kIsWeb ? 'audio/wav' : 'audio/mp4';

  /// File extension matching [recordingMimeType].
  static String get recordingExtension => kIsWeb ? 'wav' : 'm4a';

  /// Filename to send with the upload, matching [recordingMimeType].
  static String get recordingFilename => 'voice_note.$recordingExtension';

  final SpeechToText _speech = SpeechToText();
  final AudioRecorder _recorder;
  AudioPlayer? _audioPlayer;
  FlutterTts? _fallbackTts;
  String _lastWords = '';
  bool _speechReady = false;
  bool _finalResultDelivered = false;
  ValueChanged<String>? _onFinalResult;
  ValueChanged<String>? _onPartialResult;
  String? _recordingPath;
  // Bumped by every speakText() and stopPlayback(); a reply being spoken in
  // parts stops when this no longer matches the value it started with.
  int _speechSession = 0;

  // ── Recording flow ────────────────────────────────────────────────
  // Records a real audio clip (unlike speech_to_text, which never
  // exposes raw bytes - only recognized text via the OS recognizer). The
  // caller uploads the returned bytes to the rudo-chat edge function's
  // audio_base64 path, which forwards to Mansa STT server-side.
  //
  // Mobile/desktop: records to a temp file (m4a / AAC, 16 kHz mono).
  // Web: records WAV in memory with the browser's default settings; stop()
  // returns a blob: URL we fetch.

  Future<void> startRecording() async {
    final hasPermission = await _recorder.hasPermission();
    if (!hasPermission) {
      throw StateError('Microphone permission was not granted.');
    }

    if (kIsWeb) {
      // No filesystem on web. The recorder returns a blob URL on stop().
      // AAC isn't supported by browsers; WAV is the safest for server-side STT.
      _recordingPath = null;
      // Plain wav config on purpose: forcing sampleRate / numChannels on web
      // produced header-only (44 byte) recordings, so the browser's default
      // capture settings are used and the server downsamples if needed.
      await _recorder.start(
        const RecordConfig(encoder: AudioEncoder.wav),
        path: '',
      );
      return;
    }

    final dir = await getTemporaryDirectory();
    _recordingPath =
        '${dir.path}/rudo_voice_note_${DateTime.now().microsecondsSinceEpoch}.m4a';
    await _recorder.start(
      const RecordConfig(
        encoder: AudioEncoder.aacLc,
        sampleRate: recordingSampleRate,
        numChannels: recordingChannels,
      ),
      path: _recordingPath!,
    );
  }

  /// Stops the active recording and returns the captured audio bytes.
  /// Returns null if nothing was captured (e.g. stop called too soon,
  /// or start() was never called / already stopped).
  Future<Uint8List?> stopRecording() async {
    final path = await _recorder.stop();
    final resolvedPath = path ?? _recordingPath;
    _recordingPath = null;
    if (resolvedPath == null) {
      return null;
    }

    if (kIsWeb) {
      // On web, resolvedPath is a blob: URL, not a file path.
      final response = await http.get(Uri.parse(resolvedPath));
      if (response.statusCode != 200 || response.bodyBytes.isEmpty) {
        return null;
      }
      debugPrint('Recorded ${response.bodyBytes.length} bytes on web.');
      // A bare WAV header is 44 bytes: the recorder was stopped before it
      // captured any audio. Treat it as "nothing captured".
      if (response.bodyBytes.length < minRecordingBytes) {
        return null;
      }
      return response.bodyBytes;
    }

    final file = File(resolvedPath);
    if (!await file.exists()) {
      return null;
    }
    final bytes = await file.readAsBytes();
    unawaited(file.delete().catchError((_) => file));
    return bytes.length < minRecordingBytes ? null : bytes;
  }

  /// Discards the active recording without returning bytes - used when
  /// exiting voice mode mid-recording.
  Future<void> cancelRecording() async {
    if (await _recorder.isRecording()) {
      await _recorder.cancel();
    }
    _recordingPath = null;
  }

  Future<void> startListening({
    String? language,
    ValueChanged<String>? onFinalResult,
    ValueChanged<String>? onPartialResult,
  }) async {
    _lastWords = '';
    _finalResultDelivered = false;
    _onFinalResult = onFinalResult;
    _onPartialResult = onPartialResult;
    _speechReady = _speechReady ||
        await _speech.initialize(
          onError: (error) {
            debugPrint('Speech recognition error: $error');
            _emitFinalResultIfNeeded();
          },
          onStatus: (status) {
            debugPrint('Speech recognition status: $status');
            if (status == 'done' || status == 'notListening') {
              _emitFinalResultIfNeeded();
            }
          },
        );

    if (!_speechReady) {
      throw StateError('Speech recognition is not available on this device.');
    }

    await _speech.listen(
      listenOptions: SpeechListenOptions(
        localeId: _localeForLanguage(language),
        listenFor: const Duration(seconds: 45),
        pauseFor: const Duration(seconds: 3),
        partialResults: true,
        cancelOnError: true,
        listenMode: ListenMode.dictation,
      ),
      onResult: (SpeechRecognitionResult result) {
        _lastWords = result.recognizedWords.trim();
        if (result.finalResult) {
          _emitFinalResultIfNeeded();
        } else {
          _onPartialResult?.call(_lastWords);
        }
      },
    );
  }

  Future<String> stopAndTranscribe() async {
    if (_speech.isListening) {
      await _speech.stop();
    }
    return _lastWords.trim();
  }

  Future<Uint8List> synthesizeSpeech(String text, String language) async {
    final trimmedText = text.trim();
    if (trimmedText.isEmpty) {
      return Uint8List(0);
    }

    if (_shouldUseEdgeTts) {
      return _synthesizeMansa(trimmedText, language);
    }

    return _synthesizeOmniVoice(trimmedText, language);
  }

  /// Speaks [text] in [language]. Pass the `language` the rudo-chat response
  /// returned (the REPLY language), not the UI language, so the Mansa voice
  /// matches the text actually being read.
  ///
  /// Long replies are spoken in parts (see speech_chunks.dart): the first
  /// part starts within a few seconds and each next part is synthesized while
  /// the previous one plays, so no single request hits the 45-second timeout.
  /// If a part fails, the device voice reads the rest of the reply.
  Future<void> speakText(String text, String language) async {
    // A new reply, or stopPlayback(), ends any reply still being spoken.
    final session = ++_speechSession;
    final speakable = cleanForSpeech(text);
    if (speakable.isEmpty) {
      return;
    }

    // No Mansa voice for this language (tonga, lozi, unknown): don't even
    // try the cloud call, go straight to the device voice.
    if (_shouldUseEdgeTts && !_isMansaLanguage(language)) {
      debugPrint(
        'No Mansa TTS voice for "$language", using device TTS.',
      );
      await speakWithDeviceVoice(speakable, language);
      return;
    }

    final chunks = splitForSpeech(speakable);
    debugPrint(
      'Synthesizing "$language" reply via cloud TTS in ${chunks.length} part(s).',
    );
    await speakChunks(
      chunks: chunks,
      synthesize: (chunk) async {
        final watch = Stopwatch()..start();
        final audio = await synthesizeSpeech(chunk, language);
        // Synthesis time against audio length shows whether Mansa keeps up
        // with playback.
        final seconds = _wavSeconds(audio);
        debugPrint(
          'Voice part ready: ${chunk.length} chars in '
          '${watch.elapsedMilliseconds} ms, '
          '${seconds == null ? '?' : seconds.toStringAsFixed(1)} s of audio.',
        );
        return audio;
      },
      play: playAudio,
      fallback: (rest) => speakWithDeviceVoice(rest, language),
      isCancelled: () => session != _speechSession,
      log: (message) => debugPrint(message),
    );
  }

  Future<void> playAudio(Uint8List audioBytes) async {
    if (audioBytes.isEmpty) {
      return;
    }
    final audioPlayer = _audioPlayer ??= AudioPlayer();
    await audioPlayer.stop();

    // Android's MediaPlayer rejected the in-memory BytesSource for Mansa's WAV
    // ("Failed to set source", MEDIA_ERROR_UNKNOWN). Two fixes: repair the WAV
    // header (streamed WAVs often carry 0 / 0xFFFFFFFF chunk sizes), and play
    // from a temp file instead of a BytesSource (mobile only; web has no
    // filesystem so it plays from memory).
    debugPrint(
        'TTS audio: ${audioBytes.length} bytes, ${_describeWav(audioBytes)}');
    final playable = _fixWavHeader(audioBytes);
    final isWav = _looksLikeWav(playable);
    final mime = isWav ? 'audio/wav' : 'audio/mpeg';

    // Never wait much longer than the clip itself for the end-of-playback
    // event, so a missed event can't leave a reply silent half-way.
    final clipSeconds = _wavSeconds(playable);
    final maxWait = clipSeconds == null
        ? const Duration(seconds: 120)
        : Duration(milliseconds: ((clipSeconds + 4) * 1000).round());
    void onNoEndEvent() => debugPrint(
          'No end-of-playback event after ${maxWait.inSeconds} s; continuing.',
        );

    final playbackEnded = Future.any<void>([
      audioPlayer.onPlayerComplete.first,
      audioPlayer.onPlayerStateChanged
          .firstWhere((state) =>
              state == PlayerState.completed || state == PlayerState.stopped)
          .then((_) {}),
    ]);

    if (kIsWeb) {
      await audioPlayer.play(BytesSource(playable, mimeType: mime));
      await playbackEnded.timeout(maxWait, onTimeout: onNoEndEvent);
      return;
    }

    final dir = await getTemporaryDirectory();
    final file = File(
      '${dir.path}/rudo_tts_${DateTime.now().microsecondsSinceEpoch}.${isWav ? 'wav' : 'mp3'}',
    );
    await file.writeAsBytes(playable, flush: true);

    try {
      await audioPlayer.play(DeviceFileSource(file.path, mimeType: mime));
      await playbackEnded.timeout(maxWait, onTimeout: onNoEndEvent);
    } finally {
      unawaited(file.delete().catchError((_) => file));
    }
  }

  Future<void> speakWithDeviceVoice(String text, String language) async {
    final trimmedText = text.trim();
    if (trimmedText.isEmpty) {
      return;
    }

    final fallbackTts = _fallbackTts ??= FlutterTts();
    await _audioPlayer?.stop();
    await fallbackTts.stop();
    await fallbackTts.awaitSpeakCompletion(true);
    await fallbackTts.setLanguage(_ttsLocaleForLanguage(language));
    await fallbackTts.setSpeechRate(0.46);
    await fallbackTts.setPitch(1.0);
    await fallbackTts.setVolume(1.0);
    await fallbackTts.speak(trimmedText);
  }

  Future<void> stopPlayback() async {
    // Stops a reply that is being spoken in parts from starting its next part.
    _speechSession++;
    await _audioPlayer?.stop();
    await _fallbackTts?.stop();
  }

  Future<void> dispose() async {
    await _speech.cancel();
    await cancelRecording();
    await _recorder.dispose();
    await stopPlayback();
    await _audioPlayer?.dispose();
    _audioPlayer = null;
    _fallbackTts = null;
  }

  void _emitFinalResultIfNeeded() {
    final words = _lastWords.trim();
    if (_finalResultDelivered || words.isEmpty) {
      return;
    }
    _finalResultDelivered = true;
    _onFinalResult?.call(words);
  }

  /// True when TTS should go through the Supabase edge function (Mansa).
  /// OmniVoice is only used if explicitly selected or if a URL is configured
  /// and no edge function is set.
  bool get _shouldUseEdgeTts {
    final provider = ttsProvider.trim().toLowerCase();
    if (provider == 'sahara' || provider == 'mansa') {
      return true;
    }
    if (provider == 'omnivoice' || provider == 'omni_voice') {
      return false;
    }
    return omnivoiceApiUrl.isEmpty && saharaTtsEdgeFunction.isNotEmpty;
  }

  /// Synthesizes speech via the Mansa TTS edge function, so MANSA_API_KEY
  /// never reaches the client. Supports english, shona, bemba, chinyanja
  /// and ndebele. The function picks the voice itself; the client only sends
  /// the text and the language key.
  Future<Uint8List> _synthesizeMansa(
    String trimmedText,
    String language,
  ) async {
    final mansaLanguage = _mansaLanguageKey(language);
    if (mansaLanguage == null) {
      throw StateError(
        'Mansa TTS has no voice for language "$language" - '
        'supported: ${mansaTtsLanguages.join(', ')}.',
      );
    }

    final response = await supabase.Supabase.instance.client.functions.invoke(
      saharaTtsEdgeFunction,
      body: {
        'text': trimmedText,
        'language': mansaLanguage,
      },
    ).timeout(const Duration(seconds: 45));

    final data = response.data;
    if (data is Map) {
      final audioBase64 = data['audio_base64'];
      if (audioBase64 is String && audioBase64.isNotEmpty) {
        return base64Decode(audioBase64);
      }
      final error = data['error'];
      if (error is String && error.isNotEmpty) {
        throw StateError(error);
      }
    }

    throw StateError(
      '$saharaTtsEdgeFunction Edge Function did not return audio bytes.',
    );
  }

  Future<Uint8List> _synthesizeOmniVoice(
    String trimmedText,
    String language,
  ) async {
    if (omnivoiceApiUrl.isEmpty) {
      throw StateError('OMNIVOICE_API_URL is not configured.');
    }

    final uri = Uri.parse(omnivoiceApiUrl);
    final isWaveSpeed = uri.host.contains('wavespeed.ai');
    final response = await http.post(
      uri,
      headers: {
        'Content-Type': 'application/json',
        if (omnivoiceApiKey.isNotEmpty)
          'Authorization': 'Bearer $omnivoiceApiKey',
      },
      body: jsonEncode(
        isWaveSpeed
            ? _waveSpeedBody(trimmedText, language)
            : _standardOmniVoiceBody(trimmedText, language),
      ),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('OmniVoice TTS failed with ${response.statusCode}.');
    }

    final contentType = response.headers['content-type'] ?? '';
    if (contentType.startsWith('audio/') ||
        contentType == 'application/octet-stream') {
      return response.bodyBytes;
    }

    return _audioFromJson(response.body);
  }

  Map<String, dynamic> _standardOmniVoiceBody(String text, String language) => {
        'model': 'omnivoice',
        'input': text,
        'voice': 'rudo_female_young_adult_warm',
        'response_format': 'mp3',
        'language': language,
        'voice_design': {
          'gender': 'female',
          'age': 'young_adult',
          'pitch': 'warm_medium',
          'style': 'calm_clear',
        },
      };

  Map<String, dynamic> _waveSpeedBody(String text, String language) => {
        'text': text,
        'language': language,
        'voice': {
          'gender': 'female',
          'age': 'young_adult',
          'pitch': 'warm_medium',
          'style': 'calm_clear',
        },
      };

  Uint8List _audioFromJson(String body) {
    final data = jsonDecode(body);
    if (data is! Map<String, dynamic>) {
      throw StateError('OmniVoice response did not include audio.');
    }

    final audioBase64 = data['audio_base64'] ??
        data['audio'] ??
        data['data']?['audio_base64'] ??
        data['data']?['audio'];
    if (audioBase64 is String && audioBase64.isNotEmpty) {
      return base64Decode(audioBase64);
    }

    final audioUrl = data['url'] ??
        data['audio_url'] ??
        data['data']?['url'] ??
        data['data']?['audio_url'];
    if (audioUrl is String && audioUrl.isNotEmpty) {
      throw StateError('OmniVoice returned an audio URL instead of bytes.');
    }

    throw StateError('OmniVoice response did not include audio bytes.');
  }

  /// Normalizes app language names ("Nyanja", "chichewa", "sn", ...) to the
  /// key the Mansa edge function expects, or null if Mansa has no voice.
  String? _mansaLanguageKey(String language) {
    final key = language.trim().toLowerCase().split(RegExp(r'[-_]')).first;
    final normalized = switch (key) {
      'en' => 'english',
      'sn' => 'shona',
      'nd' || 'nde' => 'ndebele',
      'bem' => 'bemba',
      'ny' || 'nya' || 'nyanja' || 'chichewa' => 'chinyanja',
      _ => key,
    };
    return mansaTtsLanguages.contains(normalized) ? normalized : null;
  }

  bool _isMansaLanguage(String language) => _mansaLanguageKey(language) != null;

  bool _looksLikeWav(Uint8List b) =>
      b.length >= 12 &&
      String.fromCharCodes(b.sublist(0, 4)) == 'RIFF' &&
      String.fromCharCodes(b.sublist(8, 12)) == 'WAVE';

  /// Logs format code / channels / rate / bits so a bad Mansa WAV is visible.
  String _describeWav(Uint8List b) {
    if (!_looksLikeWav(b)) {
      return 'not WAV (first bytes: ${b.take(4).toList()})';
    }
    if (b.length < 36) return 'WAV (truncated header)';
    final v = ByteData.sublistView(b);
    return 'WAV fmt=${v.getUint16(20, Endian.little)} '
        'ch=${v.getUint16(22, Endian.little)} '
        'rate=${v.getUint32(24, Endian.little)} '
        'bits=${v.getUint16(34, Endian.little)} '
        'riffSize=${v.getUint32(4, Endian.little)}';
  }

  /// Length of a WAV clip in seconds, from its byte rate and size, or null if
  /// [b] is not a WAV.
  double? _wavSeconds(Uint8List b) {
    if (!_looksLikeWav(b) || b.length <= 44) return null;
    final byteRate = ByteData.sublistView(b).getUint32(28, Endian.little);
    if (byteRate <= 0) return null;
    return (b.length - 44) / byteRate;
  }

  /// Rewrites the RIFF and data chunk sizes to match the real byte count.
  /// Streamed WAVs often declare 0 or 0xFFFFFFFF, which Android rejects.
  Uint8List _fixWavHeader(Uint8List b) {
    if (!_looksLikeWav(b)) return b;
    final out = Uint8List.fromList(b);
    final v = ByteData.sublistView(out);
    v.setUint32(4, out.length - 8, Endian.little);
    var off = 12;
    while (off + 8 <= out.length) {
      final id = String.fromCharCodes(out.sublist(off, off + 4));
      final size = v.getUint32(off + 4, Endian.little);
      if (id == 'data') {
        final remaining = out.length - (off + 8);
        if (size == 0 || size > remaining) {
          v.setUint32(off + 4, remaining, Endian.little);
        }
        break;
      }
      off += 8 + size + (size % 2);
    }
    return out;
  }

  String _localeForLanguage(String? language) {
    final value = (language ?? '').toLowerCase();
    return switch (value) {
      'shona' => 'sn_ZW',
      'ndebele' => 'nd_ZW',
      'tonga' => 'toi_ZM',
      'bemba' => 'bem_ZM',
      'lozi' => 'loz_ZM',
      'chinyanja' || 'nyanja' => 'ny_ZM',
      _ => 'en_US',
    };
  }

  String _ttsLocaleForLanguage(String language) {
    return switch (language.toLowerCase()) {
      'shona' => 'sn-ZW',
      'ndebele' => 'nd-ZW',
      'tonga' => 'toi-ZM',
      'bemba' => 'bem-ZM',
      'lozi' => 'loz-ZM',
      'chinyanja' || 'nyanja' => 'ny-ZM',
      _ => 'en-US',
    };
  }
}