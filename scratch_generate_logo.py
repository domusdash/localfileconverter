import os
from PIL import Image, ImageDraw

def generate_blueprint_logo(size=180):
    bg = Image.new("RGBA", (size, size), (11, 26, 48, 255)) # #0b1a30
    draw = ImageDraw.Draw(bg)
    
    # Faint grid lines
    grid_color = (56, 189, 248, 38) # rgba(56, 189, 248, 0.15)
    step = size // 4
    for i in range(1, 4):
        draw.line([(i * step, 0), (i * step, size)], fill=grid_color, width=1)
        draw.line([(0, i * step), (size, i * step)], fill=grid_color, width=1)
        
    # Outer dashed circle (approx with smooth circle)
    center = size // 2
    r_outer = int(size * 0.35)
    draw.ellipse([center - r_outer, center - r_outer, center + r_outer, center + r_outer], outline=(56, 189, 248, 100), width=2)
    
    # Inner refresh arrow shape in cyan #38bdf8
    cyan = (56, 189, 248, 255)
    r_inner = int(size * 0.22)
    draw.arc([center - r_inner, center - r_inner, center + r_inner, center + r_inner], start=220, end=40, fill=cyan, width=4)
    draw.arc([center - r_inner, center - r_inner, center + r_inner, center + r_inner], start=40, end=220, fill=cyan, width=4)
    
    return bg.convert("RGB")

def main():
    target_dir = "/Users/benroberts/Sites/blueprintconverter"
    logo_180 = generate_blueprint_logo(180)
    logo_180.save(os.path.join(target_dir, "logo.png"), "PNG")
    logo_180.save(os.path.join(target_dir, "apple-touch-icon.png"), "PNG")
    print("Generated logo.png and apple-touch-icon.png for blueprintconverter")

if __name__ == "__main__":
    main()
