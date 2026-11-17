"""
QR Code Verification Test
Tests local generation of the FJ QR code, file existence,
independent decoding of the PNG pixels, and exact destination match.
"""

import sys
import os
from pathlib import Path

# Add project root to sys.path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import qr_engine
from qr_decoder import decode_qr_image
from generate_qr import render_fj_qr, DESTINATION_URL

def test_qr_generation_and_decoding():
    print("Testing QR generation and independent decoding...")
    version = 4
    ec_level = 'M'
    qr = qr_engine.QRCode(version=version, ec_level=ec_level)
    matrix = qr.encode(DESTINATION_URL)
    
    scratch_dir = Path(os.environ.get("TEMP", "/tmp")) / "fj_test_qr"
    scratch_dir.mkdir(parents=True, exist_ok=True)
    test_png = scratch_dir / "test_qr.png"
    
    img = render_fj_qr(matrix, version=version, box_size=16, border=4, transparent=False)
    img.save(test_png, "PNG")
    
    assert test_png.exists(), "PNG file was not created!"
    print(f"File created: {test_png} ({test_png.stat().st_size} bytes)")
    
    decoded = decode_qr_image(test_png, version=version, ec_level=ec_level)
    print(f"Decoded URL: {decoded}")
    assert decoded == DESTINATION_URL, f"Expected {DESTINATION_URL}, got {decoded}"
    print("PASS: QR Code independently verified and exact destination matched!\n")

if __name__ == "__main__":
    test_qr_generation_and_decoding()
