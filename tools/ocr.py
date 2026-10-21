# 图片 OCR：python tools/ocr.py <image>  → 输出 JSON 文本行数组
import sys
import json

sys.stdout.reconfigure(encoding='utf-8', errors='replace')


def main():
    if len(sys.argv) < 2:
        print('[]')
        return
    try:
        from rapidocr_onnxruntime import RapidOCR
        engine = RapidOCR()
        result, _ = engine(sys.argv[1])
        lines = [item[1] for item in result] if result else []
        print(json.dumps(lines, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'error': str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == '__main__':
    main()
