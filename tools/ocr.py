# 图片 OCR + 插图提取
# 用法：
#   python tools/ocr.py <image>                      → 纯文本行 JSON 数组（兼容旧调用）
#   python tools/ocr.py <image> --figures <outdir>   → {"text": [...], "figures": ["...png"]}
# 插图提取用 OpenCV：边缘 → 闭运算 → 轮廓，排除大面积文字块，按面积取前 3 张。
import sys
import os
import json

sys.stdout.reconfigure(encoding='utf-8', errors='replace')


def ocr_boxes(engine, path):
    result, _ = engine(path)
    lines = []
    boxes = []
    for item in result or []:
        try:
            box = item[0]
            text = item[1]
            lines.append(text)
            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            boxes.append((min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)))
        except Exception:
            continue
    return lines, boxes


def extract_figures(path, boxes, outdir):
    try:
        import cv2
        import numpy as np
    except Exception:
        return []
    # OpenCV 在 Windows 上读不了中文路径，用 numpy 读字节再解码
    try:
        img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
    except Exception:
        img = cv2.imread(path)
    if img is None:
        return []
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 40, 140)
    kernel = np.ones((9, 9), np.uint8)
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=3)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    text_mask = np.zeros((h, w), np.uint8)
    for (x, y, bw, bh) in boxes:
        cv2.rectangle(text_mask, (int(x), int(y)), (int(x + bw), int(y + bh)), 255, -1)

    cands = []
    for c in contours:
        x, y, bw, bh = cv2.boundingRect(c)
        if bw < 100 or bh < 80:
            continue
        area = bw * bh
        ratio = area / float(w * h)
        if ratio < 0.05 or ratio > 0.85:
            continue
        aspect = bw / float(bh)
        if aspect < 0.2 or aspect > 6:
            continue
        inside = text_mask[y:y + bh, x:x + bw]
        text_cover = float(np.count_nonzero(inside)) / float(bw * bh)
        if text_cover > 0.5:
            continue
        cands.append((area, x, y, bw, bh))

    cands.sort(reverse=True)
    picked = []
    for area, x, y, bw, bh in cands:
        dup = False
        for (_, px, py, pw, ph) in picked:
            ix = max(0, min(x + bw, px + pw) - max(x, px))
            iy = max(0, min(y + bh, py + ph) - max(y, py))
            inter = ix * iy
            if inter / float(min(bw * bh, pw * ph) or 1) > 0.6:
                dup = True
                break
        if dup:
            continue
        picked.append((area, x, y, bw, bh))
        if len(picked) >= 3:
            break

    os.makedirs(outdir, exist_ok=True)
    out = []
    for i, (_, x, y, bw, bh) in enumerate(picked):
        m = 8
        x0, y0 = max(0, x - m), max(0, y - m)
        x1, y1 = min(w, x + bw + m), min(h, y + bh + m)
        crop = img[y0:y1, x0:x1]
        if crop.size == 0:
            continue
        name = 'figure-%d-%dx%d.png' % (i + 1, x1 - x0, y1 - y0)
        try:
            ok, buf = cv2.imencode('.png', crop)
            if ok:
                buf.tofile(os.path.join(outdir, name))
        except Exception:
            cv2.imwrite(os.path.join(outdir, name), crop)
        out.append(name)
    return out


def main():
    if len(sys.argv) < 2:
        print('[]')
        return
    path = sys.argv[1]
    figdir = None
    if '--figures' in sys.argv:
        idx = sys.argv.index('--figures')
        if idx + 1 < len(sys.argv):
            figdir = sys.argv[idx + 1]
    try:
        from rapidocr_onnxruntime import RapidOCR
        engine = RapidOCR()
        lines, boxes = ocr_boxes(engine, path)
        if figdir:
            figures = extract_figures(path, boxes, figdir)
            print(json.dumps({'text': lines, 'figures': figures}, ensure_ascii=False))
        else:
            print(json.dumps(lines, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'error': str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == '__main__':
    main()
