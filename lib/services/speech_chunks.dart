import 'dart:async';
import 'dart:typed_data';

// Long Rudo replies are spoken in parts. One Mansa TTS request for a whole
// translated answer (often 800+ characters) can take longer than the app's
// 45-second timeout, and the patient hears nothing until it finishes. Speaking
// in parts starts the voice within a few seconds. Two parts are always being
// synthesized ahead of the one that is playing, so later parts are ready by
// the time they are needed even when synthesis is slower than playback.
//
// Nothing here touches a plugin, so it is unit-tested directly
// (test/speech_chunks_test.dart).

/// The first part is short so the voice starts quickly.
const int firstSpeechChunkChars = 160;

/// The second part is synthesized at the same time as the first, so it is
/// kept fairly short too: it has to be ready when the first one ends.
const int secondSpeechChunkChars = 220;

/// Later parts, which have more time to be synthesized.
const int speechChunkChars = 320;

/// How many parts are synthesized ahead of the one that is playing.
const int speechLookahead = 2;

/// Turns a chat reply into plain text for a voice: removes markdown that
/// should not be read aloud (bold and bullet stars, backticks, heading and
/// quote markers), puts everything on one line, and ends each list item or
/// paragraph with a full stop so the voice pauses between them.
String cleanForSpeech(String text) {
  final lines = text
      .replaceAll(RegExp(r'[*`]+'), ' ')
      .split(RegExp(r'\n+'))
      .map((line) => line
          .replaceFirst(RegExp(r'^\s*(?:#+|>+|[-•])\s+'), '')
          .replaceAll(RegExp(r'\s+'), ' ')
          .trim())
      .where((line) => line.isNotEmpty)
      .toList();
  for (var i = 0; i < lines.length - 1; i++) {
    if (!RegExp(r'[.!?:;,]$').hasMatch(lines[i])) {
      lines[i] = '${lines[i]}.';
    }
  }
  return lines.join(' ');
}

/// Splits [text] into parts for speaking, at sentence ends where possible.
/// Part 1 is at most [firstMaxChars], part 2 at most [secondMaxChars] and the
/// rest at most [maxChars] (a single sentence longer than its limit makes a
/// longer part, up to [maxChars]). A sentence longer than [maxChars] is split
/// between words. No words are dropped or reordered.
List<String> splitForSpeech(
  String text, {
  int firstMaxChars = firstSpeechChunkChars,
  int secondMaxChars = secondSpeechChunkChars,
  int maxChars = speechChunkChars,
}) {
  final clean = cleanForSpeech(text);
  if (clean.isEmpty) return const [];

  final chunks = <String>[];
  var current = '';
  for (final sentence in _sentences(clean)) {
    for (final piece in _splitLongSentence(sentence, maxChars)) {
      final limit = switch (chunks.length) {
        0 => firstMaxChars,
        1 => secondMaxChars,
        _ => maxChars,
      };
      final candidate = current.isEmpty ? piece : '$current $piece';
      if (current.isEmpty || candidate.length <= limit) {
        current = candidate;
      } else {
        chunks.add(current);
        current = piece;
      }
    }
  }
  if (current.isNotEmpty) chunks.add(current);
  return chunks;
}

// Sentences end at . ! or ? followed by a space or the end of the text, so
// "2.5 mg" and "10.5%" stay in one piece.
final RegExp _sentencePattern = RegExp(r'\S.*?(?:[.!?]+(?=\s|$)|$)');

List<String> _sentences(String text) => _sentencePattern
    .allMatches(text)
    .map((match) => match.group(0)!.trim())
    .where((sentence) => sentence.isNotEmpty)
    .toList();

List<String> _splitLongSentence(String sentence, int maxChars) {
  if (sentence.length <= maxChars) return [sentence];
  final pieces = <String>[];
  var current = '';
  for (final word in sentence.split(' ')) {
    final candidate = current.isEmpty ? word : '$current $word';
    if (current.isEmpty || candidate.length <= maxChars) {
      current = candidate;
    } else {
      pieces.add(current);
      current = word;
    }
  }
  if (current.isNotEmpty) pieces.add(current);
  return pieces;
}

/// Speaks [chunks] in order with the cloud voice.
///
/// Parts 1 and 2 are synthesized at once. When part N starts playing, parts
/// up to N + [lookahead] are already being synthesized, so later parts are
/// usually ready before they are needed.
///
/// A part that fails quickly (busy service, network blip) is retried once
/// after [retryDelay]; a timed-out part is not, since it already cost the full
/// wait. If a part still fails, [fallback] receives that part and everything
/// after it, so nothing is skipped and nothing already played is repeated.
/// Stops as soon as [isCancelled] returns true (for example when the patient
/// leaves voice mode).
Future<void> speakChunks({
  required List<String> chunks,
  required Future<Uint8List> Function(String chunk) synthesize,
  required Future<void> Function(Uint8List audio) play,
  required Future<void> Function(String rest) fallback,
  required bool Function() isCancelled,
  void Function(String message)? log,
  int lookahead = speechLookahead,
  Duration retryDelay = const Duration(milliseconds: 800),
}) async {
  if (chunks.isEmpty) return;
  final total = chunks.length;
  final pending = <int, Future<Uint8List>>{};

  Future<Uint8List> attempt(int index) async {
    try {
      return await synthesize(chunks[index]);
    } catch (error) {
      if (error is TimeoutException || isCancelled()) rethrow;
      log?.call('Voice part ${index + 1}/$total failed ($error), retrying once.');
      await Future<void>.delayed(retryDelay);
      return synthesize(chunks[index]);
    }
  }

  // Starts synthesis for every part up to [last] that is not started yet.
  void startUpTo(int last) {
    for (var i = 0; i <= last && i < total; i++) {
      if (pending.containsKey(i)) continue;
      final future = attempt(i);
      // Mark a failure as handled now. It is still thrown when this part is
      // awaited below, but if playback is cancelled first it must not surface
      // as an unhandled error.
      unawaited(future.then<void>((_) {}, onError: (Object _) {}));
      pending[i] = future;
    }
  }

  startUpTo(lookahead - 1);
  for (var i = 0; i < total; i++) {
    late final Uint8List audio;
    try {
      audio = await pending[i]!;
    } catch (error) {
      if (isCancelled()) return;
      log?.call(
        'Cloud voice failed on part ${i + 1}/$total, '
        'using device TTS for the rest: $error',
      );
      await fallback(chunks.sublist(i).join(' '));
      return;
    }
    if (isCancelled()) return;
    startUpTo(i + lookahead);
    log?.call('Playing voice part ${i + 1}/$total.');
    await play(audio);
    if (isCancelled()) return;
  }
}
