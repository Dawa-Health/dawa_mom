#!/usr/bin/env python3
"""
Pull the lesson transcripts straight out of the Dart source, so the Dart file
stays the single source of truth and nothing is retyped.

    python3 tools/extract_transcripts.py \
        lib/features/learning/domain/dawa_learning_content.dart \
        > lesson_texts.json
"""
import json
import re
import sys


def extract(dart_source, const_name="dawaPregnancyBasicsTranscripts"):
    m = re.search(rf"const\s+{const_name}\s*=\s*<String,\s*String>\s*\{{", dart_source)
    if not m:
        raise SystemExit(f"Could not find `const {const_name} = <String, String>{{` in the file.")
    start = m.end()
    end = dart_source.find("\n};", start)
    if end == -1:
        raise SystemExit("Could not find the closing `};` of the map.")
    body = dart_source[start:end]

    entries = {}
    for key, text in re.findall(r"'([^']+)'\s*:\s*'''\n?(.*?)\n?\s*'''", body, flags=re.S):
        text = text.replace("\\'", "'").replace("\\$", "$").strip()
        entries[key] = text
    if not entries:
        raise SystemExit("Found the map but no '''triple-quoted''' entries in it.")
    return entries


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    with open(sys.argv[1], encoding="utf-8") as f:
        print(json.dumps(extract(f.read()), ensure_ascii=False, indent=2))
