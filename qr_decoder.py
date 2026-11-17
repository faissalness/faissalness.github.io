"""
Add decode_qr_image to qr_engine.py to decode directly from a saved PNG image file.
"""
from PIL import Image

def decode_qr_image(image_path, version=4, ec_level='M'):
    img = Image.open(image_path).convert('RGBA')
    width, height = img.size
    size = version * 4 + 17  # 33 for version 4
    
    # Locate quiet zone and module boundaries
    # Find bounding box of dark pixels
    pixels = img.load()
    min_x, max_x, min_y, max_y = width, 0, height, 0
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            # Check if dark pixel
            if a > 128 and (r + g + b) / 3 < 128:
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y
                
    qr_w = max_x - min_x + 1
    qr_h = max_y - min_y + 1
    module_w = qr_w / size
    module_h = qr_h / size
    
    modules = [[False] * size for _ in range(size)]
    for r in range(size):
        for c in range(size):
            cx = int(min_x + (c + 0.5) * module_w)
            cy = int(min_y + (r + 0.5) * module_h)
            if 0 <= cx < width and 0 <= cy < height:
                pr, pg, pb, pa = pixels[cx, cy]
                is_dark = (pa > 128 and (pr + pg + pb) / 3 < 140)
                modules[r][c] = is_dark

    import qr_engine
    return qr_engine.decode_qr_matrix(modules, version=version, ec_level=ec_level)
