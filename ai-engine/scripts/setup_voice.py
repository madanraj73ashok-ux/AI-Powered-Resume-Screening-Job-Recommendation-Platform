"""Explicit, opt-in downloads. Run once while online; inference stays offline."""
import argparse
import hashlib
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--download", action="store_true", help="Download ~150 MB of English speech models")
    args = parser.parse_args()
    if not args.download:
        parser.error("Downloads require --download. No models are fetched automatically.")
    from huggingface_hub import snapshot_download
    directory = ROOT / "models"
    directory.mkdir(exist_ok=True)
    print("Downloading faster-whisper tiny.en (~75 MB) and Piper Lessac medium (~63 MB).")
    snapshot_download("Systran/faster-whisper-tiny.en", local_dir=directory / "whisper-tiny.en",
                      allow_patterns=["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"])
    voice_base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/"
    for filename in ("en_US-lessac-medium.onnx", "en_US-lessac-medium.onnx.json", "MODEL_CARD"):
        target = directory / filename
        if not target.exists():
            urllib.request.urlretrieve(voice_base + filename, target.with_suffix(target.suffix + ".part"))
            target.with_suffix(target.suffix + ".part").replace(target)
    manifest = {str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in directory.rglob("*") if p.is_file() and ".cache" not in p.parts}
    (directory / "download-manifest.json").write_text(json.dumps(manifest, indent=2))
    print("Models ready. Checksums saved in models/download-manifest.json. No inference downloads needed.")


if __name__ == "__main__":
    main()
