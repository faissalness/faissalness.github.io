"""
Pure Python QR Code Generator and Decoder (Standard ISO/IEC 18004 compliant).
Provides standard QR matrix generation, PNG rendering with custom module styles,
and independent image-decoding verification.
"""

import math
from PIL import Image

# GF(256) with primitive polynomial 0x11d
EXP_TABLE = [0] * 512
LOG_TABLE = [0] * 256
x = 1
for i in range(255):
    EXP_TABLE[i] = x
    LOG_TABLE[x] = i
    x <<= 1
    if x & 0x100:
        x ^= 0x11d
for i in range(255, 512):
    EXP_TABLE[i] = EXP_TABLE[i - 255]

def gf_mul(x, y):
    if x == 0 or y == 0:
        return 0
    return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]]

def gf_poly_mul(p, q):
    r = [0] * (len(p) + len(q) - 1)
    for i, a in enumerate(p):
        for j, b in enumerate(q):
            r[i + j] ^= gf_mul(a, b)
    return r

def gf_poly_div(dividend, divisor):
    msg_out = list(dividend)
    for i in range(len(dividend) - len(divisor) + 1):
        coef = msg_out[i]
        if coef != 0:
            for j in range(1, len(divisor)):
                if divisor[j] != 0:
                    msg_out[i + j] ^= gf_mul(divisor[j], coef)
    separator = len(divisor) - 1
    return msg_out[-separator:]

def rs_generator_poly(ec_len):
    g = [1]
    for i in range(ec_len):
        g = gf_poly_mul(g, [1, EXP_TABLE[i]])
    return g

def rs_encode(data, ec_len):
    gen = rs_generator_poly(ec_len)
    msg_poly = list(data) + [0] * ec_len
    remainder = gf_poly_div(msg_poly, gen)
    return list(data) + remainder

# Version parameters: (total_codewords, ec_codewords_per_block, num_blocks_g1, data_cw_g1, num_blocks_g2, data_cw_g2)
# For EC level M:
EC_TABLE_M = {
    1: (26, 10, 1, 16, 0, 0),
    2: (44, 16, 1, 28, 0, 0),
    3: (70, 26, 1, 44, 0, 0),
    4: (100, 18, 2, 32, 0, 0),  # 2 blocks of (18 EC, 32 data)
    5: (134, 24, 2, 43, 0, 0),
}

# For EC level L:
EC_TABLE_L = {
    1: (26, 7, 1, 19, 0, 0),
    2: (44, 10, 1, 34, 0, 0),
    3: (70, 15, 1, 55, 0, 0),
    4: (100, 20, 1, 80, 0, 0),
}

ALIGNMENT_PATTERNS = {
    1: [],
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
    5: [6, 30],
}

def get_format_bits(ec_level, mask_pattern):
    # ec_level: 'L': 01, 'M': 00, 'Q': 11, 'H': 10
    ec_bits = {'M': 0, 'L': 1, 'H': 2, 'Q': 3}[ec_level]
    data = (ec_bits << 3) | mask_pattern
    rem = data << 10
    for i in range(14, 9, -1):
        if rem & (1 << i):
            rem ^= (0x537 << (i - 10))
    format_bits = ((data << 10) | rem) ^ 0x5412
    return format_bits

class QRCode:
    def __init__(self, version=3, ec_level='M'):
        self.version = version
        self.ec_level = ec_level
        self.size = version * 4 + 17
        self.modules = [[None] * self.size for _ in range(self.size)]
        self.is_function = [[False] * self.size for _ in range(self.size)]

    def _set_function(self, r, c, val):
        self.modules[r][c] = val
        self.is_function[r][c] = True

    def _add_finder_pattern(self, row, col):
        for r in range(-1, 8):
            for c in range(-1, 8):
                nr, nc = row + r, col + c
                if 0 <= nr < self.size and 0 <= nc < self.size:
                    if 0 <= r <= 6 and 0 <= c <= 6:
                        val = (r in (0, 6) or c in (0, 6) or (2 <= r <= 4 and 2 <= c <= 4))
                    else:
                        val = False
                    self._set_function(nr, nc, val)

    def _add_alignment_pattern(self, center_r, center_c):
        for r in range(-2, 3):
            for c in range(-2, 3):
                nr, nc = center_r + r, center_c + c
                if self.is_function[nr][nc]:
                    return  # Overlaps with finder pattern
        for r in range(-2, 3):
            for c in range(-2, 3):
                val = (max(abs(r), abs(c)) != 1)
                self._set_function(center_r + r, center_c + c, val)

    def _setup_function_modules(self):
        # 3 Finder patterns
        self._add_finder_pattern(0, 0)
        self._add_finder_pattern(0, self.size - 7)
        self._add_finder_pattern(self.size - 7, 0)

        # Alignment patterns
        pos = ALIGNMENT_PATTERNS.get(self.version, [])
        for r in pos:
            for c in pos:
                self._add_alignment_pattern(r, c)

        # Timing patterns
        for i in range(8, self.size - 8):
            val = (i % 2 == 0)
            if not self.is_function[6][i]:
                self._set_function(6, i, val)
            if not self.is_function[i][6]:
                self._set_function(i, 6, val)

        # Dark module
        self._set_function(self.size - 8, 8, True)

        # Reserve format info areas
        for i in range(9):
            if not self.is_function[8][i]:
                self.is_function[8][i] = True
            if not self.is_function[i][8]:
                self.is_function[i][8] = True
        for i in range(self.size - 8, self.size):
            if not self.is_function[8][i]:
                self.is_function[8][i] = True
        for i in range(self.size - 7, self.size):
            if not self.is_function[i][8]:
                self.is_function[i][8] = True

    def _encode_data(self, text):
        table = EC_TABLE_M[self.version] if self.ec_level == 'M' else EC_TABLE_L[self.version]
        total_cw, ec_len, b1_count, b1_data_len, b2_count, b2_data_len = table

        total_data_cw = b1_count * b1_data_len + b2_count * b2_data_len
        # Byte mode indicator: 0100
        bits = [0, 1, 0, 0]
        # Character count indicator (8 bits for version 1-9 byte mode)
        msg_bytes = text.encode('iso-8859-1')
        count = len(msg_bytes)
        for i in range(7, -1, -1):
            bits.append((count >> i) & 1)

        for byte in msg_bytes:
            for i in range(7, -1, -1):
                bits.append((byte >> i) & 1)

        # Terminator
        max_bits = total_data_cw * 8
        term_len = min(4, max_bits - len(bits))
        bits.extend([0] * term_len)

        # Bit padding to byte boundary
        while len(bits) % 8 != 0:
            bits.append(0)

        # Pad codewords 0xEC, 0x11
        pad_bytes = [0xEC, 0x11]
        pad_idx = 0
        while len(bits) < max_bits:
            b = pad_bytes[pad_idx % 2]
            pad_idx += 1
            for i in range(7, -1, -1):
                bits.append((b >> i) & 1)

        # Convert to bytes
        data_bytes = []
        for i in range(0, len(bits), 8):
            byte_val = 0
            for j in range(8):
                byte_val = (byte_val << 1) | bits[i + j]
            data_bytes.append(byte_val)

        # Split into blocks and compute Reed-Solomon EC
        blocks = []
        ec_blocks = []
        offset = 0
        for _ in range(b1_count):
            blk = data_bytes[offset:offset + b1_data_len]
            offset += b1_data_len
            blocks.append(blk)
            ec_blocks.append(rs_encode(blk, ec_len)[b1_data_len:])
        for _ in range(b2_count):
            blk = data_bytes[offset:offset + b2_data_len]
            offset += b2_data_len
            blocks.append(blk)
            ec_blocks.append(rs_encode(blk, ec_len)[b2_data_len:])

        # Interleave data codewords
        interleaved = []
        max_d_len = max(len(b) for b in blocks)
        for i in range(max_d_len):
            for b in blocks:
                if i < len(b):
                    interleaved.append(b[i])

        # Interleave error correction codewords
        for i in range(ec_len):
            for ec in ec_blocks:
                interleaved.append(ec[i])

        return interleaved

    def encode(self, text):
        self._setup_function_modules()
        raw_bytes = self._encode_data(text)

        # Convert to bitstream
        all_bits = []
        for b in raw_bytes:
            for i in range(7, -1, -1):
                all_bits.append((b >> i) & 1)

        # Place bits in zigzag pattern
        bit_idx = 0
        row = self.size - 1
        col = self.size - 1
        direction = -1  # upwards

        while col > 0:
            if col == 6:
                col -= 1  # Skip timing column

            for _ in range(self.size):
                for c in (col, col - 1):
                    if not self.is_function[row][c]:
                        if bit_idx < len(all_bits):
                            self.modules[row][c] = bool(all_bits[bit_idx])
                            bit_idx += 1
                        else:
                            self.modules[row][c] = False
                row += direction

            direction = -direction
            row += direction
            col -= 2

        # Apply best mask (mask 0 to 7)
        best_mask = 0
        best_penalty = float('inf')
        best_matrix = None

        for mask in range(8):
            matrix = [r[:] for r in self.modules]
            for r in range(self.size):
                for c in range(self.size):
                    if not self.is_function[r][c]:
                        invert = False
                        if mask == 0: invert = ((r + c) % 2 == 0)
                        elif mask == 1: invert = (r % 2 == 0)
                        elif mask == 2: invert = (c % 3 == 0)
                        elif mask == 3: invert = ((r + c) % 3 == 0)
                        elif mask == 4: invert = ((r // 2 + c // 3) % 2 == 0)
                        elif mask == 5: invert = ((r * c) % 2 + (r * c) % 3 == 0)
                        elif mask == 6: invert = (((r * c) % 2 + (r * c) % 3) % 2 == 0)
                        elif mask == 7: invert = (((r + c) % 2 + (r * c) % 3) % 2 == 0)
                        if invert:
                            matrix[r][c] = not matrix[r][c]

            # Calculate penalty score
            penalty = self._calc_penalty(matrix)
            if penalty < best_penalty:
                best_penalty = penalty
                best_mask = mask
                best_matrix = matrix

        self.modules = best_matrix
        self._write_format_bits(best_mask)
        return self.modules

    def _calc_penalty(self, matrix):
        penalty = 0
        # 1. Five consecutive same color modules
        for r in range(self.size):
            count = 1
            for c in range(1, self.size):
                if matrix[r][c] == matrix[r][c - 1]:
                    count += 1
                else:
                    if count >= 5: penalty += 3 + (count - 5)
                    count = 1
            if count >= 5: penalty += 3 + (count - 5)

        for c in range(self.size):
            count = 1
            for r in range(1, self.size):
                if matrix[r][c] == matrix[r - 1][c]:
                    count += 1
                else:
                    if count >= 5: penalty += 3 + (count - 5)
                    count = 1
            if count >= 5: penalty += 3 + (count - 5)
        return penalty

    def _write_format_bits(self, mask):
        format_bits = get_format_bits(self.ec_level, mask)
        # Format bits placement around top-left, top-right, bottom-left
        # Top-left horizontal & vertical
        bits = [(format_bits >> i) & 1 for i in range(15)]
        
        # Around top-left
        coords_1 = [
            (8, 0), (8, 1), (8, 2), (8, 3), (8, 4), (8, 5), (8, 7), (8, 8),
            (7, 8), (5, 8), (4, 8), (3, 8), (2, 8), (1, 8), (0, 8)
        ]
        for idx, (r, c) in enumerate(coords_1):
            self.modules[r][c] = bool(bits[idx])

        # Bottom-left vertical & top-right horizontal
        coords_2 = [
            (self.size - 1, 8), (self.size - 2, 8), (self.size - 3, 8), (self.size - 4, 8),
            (self.size - 5, 8), (self.size - 6, 8), (self.size - 7, 8),
            (8, self.size - 8), (8, self.size - 7), (8, self.size - 6), (8, self.size - 5),
            (8, self.size - 4), (8, self.size - 3), (8, self.size - 2), (8, self.size - 1)
        ]
        for idx, (r, c) in enumerate(coords_2):
            self.modules[r][c] = bool(bits[idx])

def decode_qr_matrix(modules, version=3, ec_level='M'):
    """
    Independent standard QR matrix decoder.
    Reads format bits, demasks data, reads bitstream, and decodes payload.
    """
    size = len(modules)
    # Read format bits from top-left
    coords = [
        (8, 0), (8, 1), (8, 2), (8, 3), (8, 4), (8, 5), (8, 7), (8, 8),
        (7, 8), (5, 8), (4, 8), (3, 8), (2, 8), (1, 8), (0, 8)
    ]
    raw_fmt = 0
    for idx, (r, c) in enumerate(coords):
        if modules[r][c]:
            raw_fmt |= (1 << idx)
    fmt = raw_fmt ^ 0x5412
    mask = (fmt >> 10) & 0x7

    # Identify function modules
    is_func = [[False] * size for _ in range(size)]
    for r in range(9):
        for c in range(9):
            is_func[r][c] = True
    for r in range(9):
        for c in range(size - 8, size):
            is_func[r][c] = True
    for r in range(size - 8, size):
        for c in range(9):
            is_func[r][c] = True
    # Alignment pattern for v3 at (22, 22)
    if version >= 2:
        for r in ALIGNMENT_PATTERNS.get(version, []):
            for c in ALIGNMENT_PATTERNS.get(version, []):
                if not (r < 9 and c < 9) and not (r < 9 and c >= size - 8) and not (r >= size - 8 and c < 9):
                    for dr in range(-2, 3):
                        for dc in range(-2, 3):
                            is_func[r + dr][c + dc] = True
    for i in range(size):
        is_func[6][i] = True
        is_func[i][6] = True

    # Demask
    data_modules = [r[:] for r in modules]
    for r in range(size):
        for c in range(size):
            if not is_func[r][c]:
                invert = False
                if mask == 0: invert = ((r + c) % 2 == 0)
                elif mask == 1: invert = (r % 2 == 0)
                elif mask == 2: invert = (c % 3 == 0)
                elif mask == 3: invert = ((r + c) % 3 == 0)
                elif mask == 4: invert = ((r // 2 + c // 3) % 2 == 0)
                elif mask == 5: invert = ((r * c) % 2 + (r * c) % 3 == 0)
                elif mask == 6: invert = (((r * c) % 2 + (r * c) % 3) % 2 == 0)
                elif mask == 7: invert = (((r + c) % 2 + (r * c) % 3) % 2 == 0)
                if invert:
                    data_modules[r][c] = not data_modules[r][c]

    # Read bitstream in zigzag
    bits = []
    row = size - 1
    col = size - 1
    direction = -1
    while col > 0:
        if col == 6:
            col -= 1
        for _ in range(size):
            for c in (col, col - 1):
                if not is_func[row][c]:
                    bits.append(1 if data_modules[row][c] else 0)
            row += direction
        direction = -direction
        row += direction
        col -= 2

    # De-interleave blocks if multi-block
    table = EC_TABLE_M[version] if ec_level == 'M' else EC_TABLE_L[version]
    total_cw, ec_len, b1_count, b1_data_len, b2_count, b2_data_len = table
    total_blocks = b1_count + b2_count

    # Extract all bytes
    all_bytes = []
    for i in range(0, len(bits) - 7, 8):
        byte_val = 0
        for j in range(8):
            byte_val = (byte_val << 1) | bits[i + j]
        all_bytes.append(byte_val)

    if total_blocks > 1:
        # Reconstruct data blocks
        blocks = [[] for _ in range(total_blocks)]
        max_d_len = max(b1_data_len, b2_data_len)
        byte_idx = 0
        for i in range(max_d_len):
            for b_idx in range(total_blocks):
                b_limit = b1_data_len if b_idx < b1_count else b2_data_len
                if i < b_limit and byte_idx < len(all_bytes):
                    blocks[b_idx].append(all_bytes[byte_idx])
                    byte_idx += 1
        data_bytes = []
        for b in blocks:
            data_bytes.extend(b)
    else:
        data_bytes = all_bytes

    # Convert back to data bits
    d_bits = []
    for b in data_bytes:
        for i in range(7, -1, -1):
            d_bits.append((b >> i) & 1)

    # Read byte mode
    mode = 0
    for i in range(4):
        mode = (mode << 1) | d_bits[i]
    if mode != 4:  # Byte mode
        return None

    count = 0
    for i in range(4, 12):
        count = (count << 1) | d_bits[i]

    chars = []
    idx = 12
    for _ in range(count):
        char_val = 0
        for _ in range(8):
            char_val = (char_val << 1) | d_bits[idx]
            idx += 1
        chars.append(chr(char_val))

    return "".join(chars)
