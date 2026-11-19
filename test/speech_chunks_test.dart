import 'dart:async';
import 'dart:typed_data';

import 'package:dawa_mom/services/speech_chunks.dart';
import 'package:flutter_test/flutter_test.dart';

// A real translated Rudo reply (Shona, with markdown bullets), the kind that
// timed out as a single Mansa TTS request.
const _longReply = '''
Kana uine nhumbu, zvakakosha kudya zvakanaka kuti iwe nemwana wako mugare zvakanaka. Hezvino zvimwe zvekudya zvakakosha:

* **Mapurotini:** Nyama isina mafuta, hove, mazai, bhinzi, nzungu. Izvi zvinobatsira pakukura kwemwana.
* **Makabhohaidhiretsi akazara:** Sadza, mupunga webrown, chingwa chewhole wheat, mbambaira. Izvi zvinopa simba.
* **Miriwo nemichero:** Edza kudya michero nemiriwo yakasiyana-siyana. Izvi zvinopa mavitamini nemaminerari akakosha.
* **Dairy products:** Mukaka, yoghurt, chizi. Izvi zvinopa calcium yemapfupa emwana.
* **Folic Acid:** Izvi zvakakosha pakutanga kwenhumbu kudzivirira matambudziko ekukura kwemwana. Inowanikwa mumashizha egirini, bhinzi, nemichero.
* **Iron:** Inowanikwa munyama tsvuku, bhinzi, nemashizha egirini. Inobatsira kudzivirira kupererwa neropa.

Zvakakoshawo kunwa mvura yakakwana. Edza kudzivisa chikafu chisina kubikwa zvakanaka, doro, uye caffeine yakawandisa.

Izvi hazvitsivi zano renyanzvi yezvehutano.''';

Uint8List _audio(int marker) => Uint8List.fromList([marker]);

void main() {
  group('cleanForSpeech', () {
    test('removes markdown and puts a pause between list items', () {
      final clean = cleanForSpeech(_longReply);
      expect(clean, isNot(matches(RegExp(r'[*#`\n]'))));
      expect(clean, contains('zvekudya zvakakosha: Mapurotini: Nyama'));
      expect(clean, contains('kupererwa neropa. Zvakakoshawo'));
    });

    test('drops heading, quote and dash markers', () {
      expect(
        cleanForSpeech('# Title\n> quote\n- item one\n- item two'),
        'Title. quote. item one. item two',
      );
    });

    test('leaves plain text alone', () {
      expect(cleanForSpeech('  Hello mama  '), 'Hello mama');
    });
  });

  group('splitForSpeech', () {
    test('a short reply stays one part', () {
      expect(splitForSpeech('Mhoroi! Makadii?'), ['Mhoroi! Makadii?']);
    });

    test('blank text gives no parts', () {
      expect(splitForSpeech('   '), isEmpty);
    });

    test('a long reply is split at sentence ends without losing words', () {
      final parts = splitForSpeech(_longReply);
      expect(parts.length, greaterThan(1));
      expect(parts[0].length, lessThanOrEqualTo(firstSpeechChunkChars));
      expect(parts[1].length, lessThanOrEqualTo(secondSpeechChunkChars));
      for (final part in parts) {
        expect(part.length, lessThanOrEqualTo(speechChunkChars));
        expect(part, matches(RegExp(r'[.!?:]$')), reason: part);
      }
      expect(parts.join(' '), cleanForSpeech(_longReply));
    });

    test('decimal numbers are not treated as sentence ends', () {
      expect(
        splitForSpeech('Take 2.5 mg daily. Rest well.'),
        ['Take 2.5 mg daily. Rest well.'],
      );
    });

    test('a sentence longer than a part is split between words', () {
      final sentence =
          '${List.generate(120, (i) => 'word$i').join(' ')}.';
      final parts = splitForSpeech(sentence);
      expect(parts.length, greaterThan(1));
      for (final part in parts) {
        expect(part.length, lessThanOrEqualTo(speechChunkChars));
      }
      expect(parts.join(' '), sentence);
    });
  });

  group('speakChunks', () {
    test('keeps two parts synthesizing ahead of the one playing', () async {
      final events = <String>[];
      await speakChunks(
        chunks: ['a', 'b', 'c', 'd'],
        synthesize: (chunk) async {
          events.add('synth:$chunk');
          return _audio(chunk.codeUnitAt(0));
        },
        play: (audio) async =>
            events.add('play:${String.fromCharCode(audio[0])}'),
        fallback: (rest) async => events.add('fallback:$rest'),
        isCancelled: () => false,
      );
      expect(events, [
        'synth:a',
        'synth:b',
        'synth:c',
        'play:a',
        'synth:d',
        'play:b',
        'play:c',
        'play:d',
      ]);
    });

    test('a part that fails once is retried and played', () async {
      var tries = 0;
      final played = <String>[];
      await speakChunks(
        chunks: ['a', 'b', 'c'],
        synthesize: (chunk) => chunk == 'b' && tries++ == 0
            ? Future<Uint8List>.error(StateError('503'))
            : Future.value(_audio(chunk.codeUnitAt(0))),
        play: (audio) async => played.add(String.fromCharCode(audio[0])),
        fallback: (rest) async => fail('no fallback expected, got "$rest"'),
        isCancelled: () => false,
        retryDelay: Duration.zero,
      );
      expect(played, ['a', 'b', 'c']);
      expect(tries, 2);
    });

    test('a part that keeps failing hands it and the rest to the device voice',
        () async {
      var bTries = 0;
      final events = <String>[];
      await speakChunks(
        chunks: ['a', 'b', 'c'],
        synthesize: (chunk) {
          if (chunk == 'b') {
            bTries++;
            return Future<Uint8List>.error(StateError('503'));
          }
          return Future.value(_audio(1));
        },
        play: (audio) async => events.add('play'),
        fallback: (rest) async => events.add('fallback:$rest'),
        isCancelled: () => false,
        retryDelay: Duration.zero,
      );
      expect(bTries, 2);
      expect(events, ['play', 'fallback:b c']);
    });

    test('a timed-out part is not retried', () async {
      var bTries = 0;
      final events = <String>[];
      await speakChunks(
        chunks: ['a', 'b', 'c'],
        synthesize: (chunk) {
          if (chunk == 'b') {
            bTries++;
            return Future<Uint8List>.error(TimeoutException('45 s'));
          }
          return Future.value(_audio(1));
        },
        play: (audio) async => events.add('play'),
        fallback: (rest) async => events.add('fallback:$rest'),
        isCancelled: () => false,
        retryDelay: Duration.zero,
      );
      expect(bTries, 1);
      expect(events, ['play', 'fallback:b c']);
    });

    test('stops when cancelled, without the device voice', () async {
      var cancelled = false;
      final events = <String>[];
      await speakChunks(
        chunks: ['a', 'b', 'c'],
        synthesize: (chunk) => chunk == 'b'
            ? Future<Uint8List>.error(StateError('timeout'))
            : Future.value(_audio(1)),
        play: (audio) async {
          events.add('play');
          cancelled = true; // e.g. the patient left voice mode
        },
        fallback: (rest) async => events.add('fallback'),
        isCancelled: () => cancelled,
        retryDelay: Duration.zero,
      );
      expect(events, ['play']);
    });

    test('does nothing for no parts', () async {
      var called = false;
      await speakChunks(
        chunks: const [],
        synthesize: (_) async {
          called = true;
          return _audio(1);
        },
        play: (_) async {
          called = true;
        },
        fallback: (_) async {
          called = true;
        },
        isCancelled: () => false,
      );
      expect(called, isFalse);
    });
  });
}
