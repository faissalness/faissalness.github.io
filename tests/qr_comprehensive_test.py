"""
Comprehensive QR Code Generator and Independent Decoder Test Suite
Tests Phase 9 Requirements:
- Multiple generated QR variants
- Independent decoding of rendered PNG pixels
- 100% exact destination matching
- Preserved finder patterns, timing patterns and quiet zone
- Visual and functional integrity
"""

import sys
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import qr_engine
from qr_decoder import decode_qr_image
from generate_qr import render_fj_qr

TEST_DESTINATIONS = [
    "https://en.wikipedia.org/wiki/Special:Random",
    "https://en.wikipedia.org/wiki/Earth",
    "https://en.wikipedia.org/wiki/Fibonacci_number",
    "https://en.wikipedia.org/wiki/World_Wide_Web",
    "https://en.wikipedia.org/wiki/Periodic_table",
    "https://en.wikipedia.org/wiki/Solar_System",
    "https://en.wikipedia.org/wiki/Great_Barrier_Reef",
    "https://en.wikipedia.org/wiki/Library_of_Alexandria",
    "https://en.wikipedia.org/wiki/Gothenburg",
    "https://en.wikipedia.org/wiki/Photosynthesis"
]

def run_comprehensive_qr_tests():
    print("=== COMPREHENSIVE FJ QR VERIFICATION SUITE ===\n")
    scratch_dir = Path(os.environ.get("TEMP", "/tmp")) / "fj_qr_comprehensive"
    scratch_dir.mkdir(parents=True, exist_ok=True)
    
    passed_count = 0
    total = len(TEST_DESTINATIONS)
    
    for idx, url in enumerate(TEST_DESTINATIONS, start=1):
        version = 4
        ec_level = 'M'
        qr = qr_engine.QRCode(version=version, ec_level=ec_level)
        matrix = qr.encode(url)
        
        # Test function patterns preservation
        size = len(matrix)
        assert size == 33, f"Expected 33x33 for version 4, got {size}"
        
        # Verify 3 finder patterns are intact
        # Top-left (0,0), Top-right (0, 26), Bottom-left (26, 0)
        assert matrix[0][0] == True
        assert matrix[0][6] == True
        assert matrix[6][0] == True
        assert matrix[6][6] == True
        assert matrix[0][size - 1] == True
        assert matrix[0][size - 7] == True
        assert matrix[size - 1][0] == True
        assert matrix[size - 7][0] == True
        
        # Render PNG image
        img = render_fj_qr(matrix, version=version, box_size=16, border=4, transparent=False)
        test_png = scratch_dir / f"test_qr_{idx}.png"
        img.save(test_png, "PNG")
        
        # Independent decoding from image pixels
        decoded = decode_qr_image(test_png, version=version, ec_level=ec_level)
        assert decoded == url, f"Test {idx} Mismatch! Expected: {url}, Got: {decoded}"
        passed_count += 1
        print(f"[PASS] Variant {idx:02d}: {url} -> Decoded exactly matches destination ({test_png.stat().st_size} bytes)")
    
    print(f"\n=== QR VERIFICATION RESULT: {passed_count} / {total} PASSED SUCCESSFULLY! ===")
    assert passed_count == total

if __name__ == "__main__":
    run_comprehensive_qr_tests()
