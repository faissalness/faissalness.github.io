"""Generate a PNG QR code for the random destination redirect."""
import argparse
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="https://faissalness.github.io/random.html?go=1")
    parser.add_argument("--output", default="random-qr.png")
    args = parser.parse_args()
    try:
        import qrcode
    except ImportError as exc:
        raise SystemExit("Install the free dependency with: python -m pip install qrcode[pil]") from exc
    qrcode.make(args.url).save(Path(args.output))
    print(f"Saved QR code to {args.output}")

if __name__ == "__main__": main()
