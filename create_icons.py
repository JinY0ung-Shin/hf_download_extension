#!/usr/bin/env python3
"""
Simple script to create basic extension icons using PIL
"""

from PIL import Image, ImageDraw
import os

def create_icon(size, output_path):
    # Create a new image with HuggingFace orange gradient background
    img = Image.new('RGB', (size, size), color='#FF9D00')
    draw = ImageDraw.Draw(img)

    # Create a circular background with gradient effect (simulate HuggingFace style)
    center = size // 2
    radius = center - 2

    # Draw a circle with HuggingFace colors
    draw.ellipse([center - radius, center - radius, center + radius, center + radius],
                 fill='#FF6B35', outline='#FF9D00', width=2)

    # Draw the hugging face emoji style or download symbol
    if size >= 32:
        # For larger icons, draw a stylized face
        # Eyes
        eye_size = max(2, size // 16)
        eye_y = center - size // 6
        left_eye_x = center - size // 6
        right_eye_x = center + size // 6

        draw.ellipse([left_eye_x - eye_size, eye_y - eye_size,
                     left_eye_x + eye_size, eye_y + eye_size], fill='white')
        draw.ellipse([right_eye_x - eye_size, eye_y - eye_size,
                     right_eye_x + eye_size, eye_y + eye_size], fill='white')

        # Smile (arc)
        smile_radius = size // 6
        smile_y = center + size // 8

        # Draw smile as arc
        bbox = [center - smile_radius, smile_y - smile_radius//2,
                center + smile_radius, smile_y + smile_radius//2]
        draw.arc(bbox, start=0, end=180, fill='white', width=max(2, size//24))

        # Add download arrow in bottom part
        arrow_y = center + size // 3
        arrow_size = size // 8
        points = [
            (center, arrow_y + arrow_size),  # bottom point
            (center - arrow_size//2, arrow_y),  # left point
            (center + arrow_size//2, arrow_y)   # right point
        ]
        draw.polygon(points, fill='white')
    else:
        # For smaller icons, just draw a simple download arrow
        arrow_size = size // 3
        shaft_width = max(1, size // 20)

        # Arrow shaft
        draw.rectangle([center - shaft_width//2, center - arrow_size//2,
                       center + shaft_width//2, center + arrow_size//2], fill='white')

        # Arrow head
        arrow_head_size = max(2, size // 10)
        points = [
            (center, center + arrow_size//2 + arrow_head_size),
            (center - arrow_head_size, center + arrow_size//2),
            (center + arrow_head_size, center + arrow_size//2)
        ]
        draw.polygon(points, fill='white')

    img.save(output_path, 'PNG')
    print(f"Created {output_path} ({size}x{size})")

def main():
    icons_dir = "icons"
    os.makedirs(icons_dir, exist_ok=True)

    sizes = [16, 32, 48, 128]

    for size in sizes:
        output_path = os.path.join(icons_dir, f"icon{size}.png")
        create_icon(size, output_path)

    print("All icons created successfully!")

if __name__ == "__main__":
    main()
