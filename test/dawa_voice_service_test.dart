import 'dart:io';

import 'package:audioplayers/audioplayers.dart';
import 'package:dawa_mom/services/voice_service.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:record/record.dart';

// ── Fakes ───────────────────────────────────────────────────────────
// Each fake uses noSuchMethod, so the tests keep compiling even if a plugin
// changes a method signature. Calls are recorded as "name:[args]".

String _name(Invocation i) =>
    i.memberName.toString().replaceAll(RegExp(r'Symbol\("|"\)'), '');

class _FakeRecorder extends Fake implements AudioRecorder {
  bool permission = true;
  bool recording = false;
  String? stopPath;
  String? startedPath;
  final calls = <String>[];

  @override
  dynamic noSuchMethod(Invocation i) {
    final name = _name(i);
    calls.add(name);
    switch (name) {
      case 'hasPermission':
        return Future<bool>.value(permission);
      case 'isRecording':
        return Future<bool>.value(recording);
      case 'stop':
        return Future<String?>.value(stopPath);
      case 'start':
        startedPath = i.namedArguments[#path] as String?;
        return Future<void>.value();
      default:
        return Future<void>.value();
    }
  }
}

class _FakeTts extends Fake implements FlutterTts {
  final calls = <String>[];

  @override
  dynamic noSuchMethod(Invocation i) {
    calls.add('${_name(i)}:${i.positionalArguments}');
    return Future<dynamic>.value(1);
  }
}

class _FakePlayer extends Fake implements AudioPlayer {
  final calls = <String>[];

  @override
  dynamic noSuchMethod(Invocation i) {
    calls.add(_name(i));
    return Future<void>.value();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory tmp;
  late _FakeRecorder recorder;
  late _FakeTts tts;
  late _FakePlayer player;
  late VoiceService service;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('dawa_voice_test');
    // path_provider's default implementation talks over this channel.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (call) async => tmp.path,
    );
    recorder = _FakeRecorder();
    tts = _FakeTts();
    player = _FakePlayer();
    service = VoiceService(
      audioPlayer: player,
      fallbackTts: tts,
      recorder: recorder,
    );
  });

  tearDown(() async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('plugins.flutter.io/path_provider'), null);
    if (await tmp.exists()) {
      await tmp.delete(recursive: true);
    }
  });

  group('static configuration', () {
    test('recording MIME type and extension (non-web)', () {
      expect(VoiceService.recordingMimeType, 'audio/mp4');
      expect(VoiceService.recordingExtension, 'm4a');
    });

    test('Mansa languages list', () {
      expect(VoiceService.mansaTtsLanguages,
          {'english', 'shona', 'bemba', 'chinyanja', 'ndebele'});
      expect(VoiceService.mansaTtsLanguages.contains('tonga'), isFalse);
      expect(VoiceService.mansaTtsLanguages.contains('lozi'), isFalse);
    });
  });

  group('recording', () {
    test('startRecording throws when microphone permission is denied',
        () async {
      recorder.permission = false;
      await expectLater(service.startRecording(), throwsStateError);
      expect(recorder.calls, ['hasPermission']);
    });

    test('startRecording records AAC to a temp .m4a file', () async {
      await service.startRecording();
      expect(recorder.calls, ['hasPermission', 'start']);
      expect(recorder.startedPath, startsWith(tmp.path));
      expect(recorder.startedPath, endsWith('.m4a'));
    });

    test('stopRecording returns the recorded bytes', () async {
      final file = File('${tmp.path}/note.m4a');
      await file.writeAsBytes([1, 2, 3, 4]);
      recorder.stopPath = file.path;

      final bytes = await service.stopRecording();
      expect(bytes, Uint8List.fromList([1, 2, 3, 4]));
    });

    test('stopRecording returns null for an empty file', () async {
      final file = File('${tmp.path}/empty.m4a');
      await file.writeAsBytes([]);
      recorder.stopPath = file.path;

      expect(await service.stopRecording(), isNull);
    });

    test('stopRecording returns null when the file does not exist', () async {
      recorder.stopPath = '${tmp.path}/missing.m4a';
      expect(await service.stopRecording(), isNull);
    });

    test('stopRecording returns null when nothing was started', () async {
      recorder.stopPath = null;
      expect(await service.stopRecording(), isNull);
    });

    test('stopRecording falls back to the path chosen by startRecording',
        () async {
      await service.startRecording();
      recorder.stopPath = null; // recorder gives no path back
      // The file was never written, so the result is null, but the
      // fallback branch (_recordingPath) is exercised.
      expect(await service.stopRecording(), isNull);
    });

    test('cancelRecording cancels only when a recording is active', () async {
      recorder.recording = false;
      await service.cancelRecording();
      expect(recorder.calls, ['isRecording']);

      recorder.calls.clear();
      recorder.recording = true;
      await service.cancelRecording();
      expect(recorder.calls, ['isRecording', 'cancel']);
    });
  });

  group('speech to text state', () {
    test('stopAndTranscribe returns empty text when nothing was heard',
        () async {
      expect(await service.stopAndTranscribe(), '');
    });
  });

  group('device voice', () {
    test('speakWithDeviceVoice configures and speaks in order', () async {
      await service.speakWithDeviceVoice('  Hello mama  ', 'english');
      expect(tts.calls, [
        'stop:[]',
        'awaitSpeakCompletion:[true]',
        'setLanguage:[en-US]',
        'setSpeechRate:[0.46]',
        'setPitch:[1.0]',
        'setVolume:[1.0]',
        'speak:[Hello mama]',
      ]);
      expect(player.calls, ['stop']);
    });

    test('speakWithDeviceVoice ignores blank text', () async {
      await service.speakWithDeviceVoice('   ', 'english');
      expect(tts.calls, isEmpty);
      expect(player.calls, isEmpty);
    });

    test('device locale is chosen per language', () async {
      final expected = {
        'shona': 'sn-ZW',
        'Ndebele': 'nd-ZW',
        'tonga': 'toi-ZM',
        'bemba': 'bem-ZM',
        'lozi': 'loz-ZM',
        'chinyanja': 'ny-ZM',
        'Nyanja': 'ny-ZM',
        'english': 'en-US',
        'klingon': 'en-US',
      };
      for (final entry in expected.entries) {
        tts.calls.clear();
        await service.speakWithDeviceVoice('hi', entry.key);
        expect(tts.calls, contains('setLanguage:[${entry.value}]'),
            reason: 'language ${entry.key}');
      }
    });
  });

  group('speakText', () {
    test('ignores blank text', () async {
      await service.speakText('  ', 'english');
      expect(tts.calls, isEmpty);
    });

    test('languages without a Mansa voice go straight to device TTS',
        () async {
      await service.speakText('Mauya', 'tonga');
      expect(tts.calls, contains('setLanguage:[toi-ZM]'));
      expect(tts.calls.last, 'speak:[Mauya]');
    });

    test('falls back to device TTS when cloud synthesis fails', () async {
      // Supabase is not initialised in unit tests, so the cloud call throws
      // and speakText must recover by using the device voice.
      await service.speakText('Hello', 'english');
      expect(tts.calls, contains('setLanguage:[en-US]'));
      expect(tts.calls.last, 'speak:[Hello]');
    });
  });

  group('synthesizeSpeech / playAudio', () {
    test('blank text returns empty bytes', () async {
      expect(await service.synthesizeSpeech('   ', 'english'), isEmpty);
    });

    test('Mansa rejects languages it has no voice for', () async {
      await expectLater(
          service.synthesizeSpeech('hello', 'tonga'), throwsStateError);
    });

    test('playAudio does nothing for empty audio', () async {
      await service.playAudio(Uint8List(0));
      expect(player.calls, isEmpty);
    });
  });

  group('stopPlayback', () {
    test('stops both the audio player and device TTS', () async {
      await service.stopPlayback();
      expect(player.calls, ['stop']);
      expect(tts.calls, ['stop:[]']);
    });
  });
}
