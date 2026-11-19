#!/usr/bin/env python3
"""
Generate lesson audio with Mansa TTS, once, ahead of time.

Reads a JSON file of {"<Language name>": "<lesson text>"}, splits each text into
sentence-sized chunks, synthesizes every chunk, joins them into one recording,
and compresses it to a small MP3 you can bundle in the app.

    export MANSA_API_KEY=...
    python3 tools/generate_lesson_audio.py lesson_texts.json --dry-run

Files go to ./lesson_audio_review by default, NOT into the app. Copy a language
into assets/audios/lessons only after a native speaker has signed it off.

Drop --dry-run to spend money. Mansa bills $0.10 per 1,000 characters and every
retry is billed again, so the script shows the cost and asks before it starts.

Language coverage (Mansa TTS): English, Shona, Bemba, Chichewa (Nyanja), Ndebele.
Tonga and Lozi have no voice and are skipped.
"""
import argparse
import io
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import wave

import requests

BASE_URL = os.environ.get("MANSA_API_BASE_URL", "https://api.mymansa.ai").rstrip("/")
API_KEY = os.environ.get("MANSA_API_KEY", "")
PRICE_PER_1K_CHARS = 0.10

# app language name (lowercase) -> (Mansa slug, voice)
# English gets the South African female accent; the other languages use the
# plain "female" voice, which speaks that language natively.
LANGUAGES = {
    "english": ("english", "south_african_female"),
    "shona": ("shona", "female"),
    "bemba": ("bemba", "female"),
    "chichewa": ("chichewa", "female"),
    "nyanja": ("chichewa", "female"),
    "chinyanja": ("chichewa", "female"),
    "ndebele": ("ndebele", "female"),
}


def clean(text):
    text = re.sub(r"[*_`#>]+", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def lint(name, text):
    """Things that sound wrong when read aloud, whatever the translation quality."""
    warnings = []

    def ctx(m):
        return text[max(0, m.start() - 14): m.end() + 14].replace("\n", " ")

    for m in re.finditer(r"[^\W\d_][,;:.!?][^\W\d_]", text):
        warnings.append(f'no space after punctuation: "...{ctx(m)}..."')
    for m in re.finditer(r"[^\W\d_]{20,}", text):
        warnings.append(f'very long word (words run together?): "{m.group(0)}"')
    for m in re.finditer(r"\([^)]*\)", text):
        warnings.append(f'text in brackets is read out loud as written: "{m.group(0)}"')
    if name.lower() != "english":
        for m in re.finditer(r"(?i)\b(seizures?|antenatal)\b", text):
            warnings.append(f'English word inside a non-English text (read with local sounds): "{m.group(0)}"')
    return warnings


def split_chunks(text, max_chars):
    """Pack whole sentences into chunks of at most max_chars characters."""
    pieces = []
    for para in re.split(r"\n\s*\n", text):
        for sent in re.split(r"(?<=[.!?])\s+", para.strip()):
            if sent.strip():
                pieces.append(sent.strip())

    chunks, cur = [], ""
    for s in pieces:
        while len(s) > max_chars:  # one very long sentence: cut at a comma or space
            cut = s.rfind(", ", 0, max_chars)
            if cut < max_chars // 2:
                cut = s.rfind(" ", 0, max_chars)
            if cut <= 0:
                cut = max_chars - 1
            if cur:
                chunks.append(cur)
                cur = ""
            chunks.append(s[: cut + 1].strip())
            s = s[cut + 1:].strip()
        if not s:
            continue
        if not cur:
            cur = s
        elif len(cur) + 1 + len(s) <= max_chars:
            cur += " " + s
        else:
            chunks.append(cur)
            cur = s
    if cur:
        chunks.append(cur)
    return chunks


def synthesize(text, slug, voice, retries=3):
    err = ""
    for attempt in range(1, retries + 1):
        try:
            r = requests.post(
                f"{BASE_URL}/v1/audio/speech",
                headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
                json={"text": text, "language": slug, "voice": voice, "stream": False},
                timeout=120,
            )
            if r.ok and r.content:
                return r.content
            err = f"HTTP {r.status_code}: {r.text[:300]}"
            if r.status_code not in (429, 500, 502, 503, 504):
                raise RuntimeError(err)
        except requests.RequestException as e:
            err = str(e)
        if attempt == retries:
            raise RuntimeError(err)
        time.sleep(2 ** attempt)


def parse_wav(data):
    """Return ((channels, bytes_per_sample, rate), pcm_bytes).

    Mansa's WAV headers can declare 0 or 0xFFFFFFFF as the data size, which
    Python's wave module chokes on, so read the chunks by hand and trust the
    real number of bytes instead.
    """
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("response is not a WAV file")
    pos, fmt = 12, None
    while pos + 8 <= len(data):
        cid = data[pos:pos + 4]
        size = struct.unpack("<I", data[pos + 4:pos + 8])[0]
        body = pos + 8
        if cid == b"fmt ":
            _, ch, rate, _, _, bits = struct.unpack("<HHIIHH", data[body:body + 16])
            fmt = (ch, bits // 8, rate)
        elif cid == b"data":
            end = body + size
            if size == 0 or end > len(data):
                end = len(data)
            if fmt is None:
                raise ValueError("data chunk before fmt chunk")
            return fmt, data[body:end]
        pos = body + size + (size % 2)
    raise ValueError("no data chunk found")


def stitch(wavs, pause_seconds=0.3):
    fmt0, parts = None, []
    for w in wavs:
        fmt, pcm = parse_wav(w)
        if fmt0 is None:
            fmt0 = fmt
        elif fmt != fmt0:
            raise ValueError(f"WAV formats differ between chunks: {fmt0} vs {fmt}")
        frame = fmt[0] * fmt[1]
        parts.append(pcm[: len(pcm) - len(pcm) % frame])
    ch, width, rate = fmt0
    silence = b"\x00" * (int(rate * pause_seconds) * ch * width)
    pcm = silence.join(parts)
    out = io.BytesIO()
    with wave.open(out, "wb") as f:
        f.setnchannels(ch)
        f.setsampwidth(width)
        f.setframerate(rate)
        f.writeframes(pcm)
    return out.getvalue(), len(pcm) / (rate * ch * width)


def to_mp3(wav_bytes, out_path, bitrate):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return False
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        tmp.write(wav_bytes)
        tmp.flush()
        subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-i", tmp.name, "-ac", "1", "-b:a", bitrate, out_path],
            check=True,
        )
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("texts", help="JSON file: {\"Language name\": \"lesson text\"}")
    ap.add_argument("--lesson-id", default="pregnancy_basics")
    ap.add_argument("--out", default="lesson_audio_review")
    ap.add_argument("--only", help="Only this language, for example Bemba")
    ap.add_argument("--max-chars", type=int, default=800, help="characters per Mansa request")
    ap.add_argument("--bitrate", default="64k")
    ap.add_argument("--dry-run", action="store_true", help="show chunks and cost, call nothing")
    ap.add_argument("--yes", action="store_true", help="do not ask before spending")
    args = ap.parse_args()

    with open(args.texts, encoding="utf-8") as f:
        lessons = json.load(f)

    plan, skipped = [], []
    for name, text in lessons.items():
        if args.only and name.lower() != args.only.lower():
            continue
        if name.lower() not in LANGUAGES:
            skipped.append(name)
            continue
        text = clean(text)
        if text:
            plan.append((name, text, split_chunks(text, args.max_chars)))

    total_chars = sum(len(t) for _, t, _ in plan)
    print(f"{'Language':<12}{'chars':>8}{'chunks':>8}{'est. cost':>11}")
    for name, text, chunks in plan:
        print(f"{name:<12}{len(text):>8}{len(chunks):>8}{'$%.2f' % (len(text) / 1000 * PRICE_PER_1K_CHARS):>11}")
    print(f"{'TOTAL':<12}{total_chars:>8}{'':>8}{'$%.2f' % (total_chars / 1000 * PRICE_PER_1K_CHARS):>11}")
    if skipped:
        print("Skipped (no Mansa voice):", ", ".join(skipped))
    any_lint = False
    for name, text, _ in plan:
        for w in lint(name, text):
            if not any_lint:
                print("\nCheck before generating (these are read out loud exactly as written):")
                any_lint = True
            print(f"  {name}: {w}")
    if args.dry_run or not plan:
        return 0

    if not API_KEY:
        sys.exit("Set MANSA_API_KEY first.")
    if not args.yes and input("Generate now? Retries are billed again. [y/N] ").strip().lower() != "y":
        return 1

    os.makedirs(args.out, exist_ok=True)
    for name, text, chunks in plan:
        slug, voice = LANGUAGES[name.lower()]
        print(f"\n{name}: {len(chunks)} chunks")
        wavs = []
        for i, chunk in enumerate(chunks, 1):
            print(f"  chunk {i}/{len(chunks)} ({len(chunk)} chars)", flush=True)
            wavs.append(synthesize(chunk, slug, voice))
        wav, seconds = stitch(wavs)
        base = os.path.join(args.out, f"{args.lesson_id}_{name.lower()}")
        if to_mp3(wav, base + ".mp3", args.bitrate):
            print(f"  wrote {base}.mp3 ({seconds:.0f} s)")
        else:
            with open(base + ".wav", "wb") as f:
                f.write(wav)
            print(f"  ffmpeg not found: wrote {base}.wav ({len(wav) / 1e6:.1f} MB). Install ffmpeg to get a small MP3.")
    print("\nListen to every file before you ship it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
