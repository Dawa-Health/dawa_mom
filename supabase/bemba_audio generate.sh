for i in $(seq 1 20); do
  python3 tools/generate_lesson_audio.py lesson_texts.json --only Bemba --yes && break
  echo "Attempt $i failed, waiting 180s..."
  sleep 180
done