"""Encode the deterministic browser frames into downloadable teaching GIFs."""
import argparse
from pathlib import Path
from PIL import Image, ImageChops

parser = argparse.ArgumentParser()
parser.add_argument("frames", type=Path)
args = parser.parse_args()
destination = Path(__file__).resolve().parents[1] / "selection"
for name in ("blocos-repeticoes", "spearman-celulas"):
    frames = []
    for path in sorted((args.frames / name).glob("*.png")):
        with Image.open(path) as im:
            frames.append(im.convert("RGB"))
    assert len(frames) == 91
    assert ImageChops.difference(frames[0], frames[-1]).getbbox(), "Animation must move"
    palette = frames[0].quantize(colors=192)
    encoded = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
    output = destination / (name + ".gif")
    encoded[0].save(output, save_all=True, append_images=encoded[1:], duration=[200] * 90 + [1800], loop=0, optimize=True, disposal=2)
    with Image.open(output) as check:
        assert check.n_frames > 20 and check.info.get("loop") == 0
        print(f"{name}: {check.n_frames} frames, {check.size}, {output.stat().st_size:,} bytes")
