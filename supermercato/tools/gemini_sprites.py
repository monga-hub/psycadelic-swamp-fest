"""Genera sprite con l'API Gemini e li converte in pixel-art pronta per il gioco.

Uso:
  python3 -I gemini_sprites.py gen  <model> <out_raw.png> <prompt_file> [input_image.png]
  python3 -I gemini_sprites.py proc <raw.png> <out.png> <target_width>
La chiave API viene aggiunta dal proxy dell'ambiente (header x-goog-api-key).
"""
import base64, json, sys, urllib.request
from PIL import Image

API = 'https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent'


def gen(model, out, prompt_file, inp=None):
    prompt = open(prompt_file, encoding='utf-8').read()
    parts = [{'text': prompt}]
    if inp:
        parts.append({'inlineData': {'mimeType': 'image/png', 'data': base64.b64encode(open(inp, 'rb').read()).decode()}})
    body = {'contents': [{'parts': parts}], 'generationConfig': {'responseModalities': ['IMAGE', 'TEXT']}}
    req = urllib.request.Request(API.format(model), data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json', 'x-goog-api-key': 'placeholder'})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, e.read().decode()[:600]); sys.exit(1)
    for c in d.get('candidates', []):
        for p in c.get('content', {}).get('parts', []):
            if 'inlineData' in p:
                open(out, 'wb').write(base64.b64decode(p['inlineData']['data']))
                print('ok', out); return
            if 'text' in p:
                print('text:', p['text'][:200])
    print('no image', json.dumps(d)[:600]); sys.exit(1)


def is_bg(px, tol):
    r, g, b = px[:3]
    # magenta e sfumature vicine
    return r > 255 - tol * 1.6 and b > 255 - tol * 1.6 and g < tol * 1.4 or (r > 180 and b > 180 and g < 90 and abs(r - b) < 60)


def proc(raw, out, width):
    im = Image.open(raw).convert('RGBA')
    px = im.load()
    W, H = im.size
    for y in range(H):
        for x in range(W):
            if is_bg(px[x, y], 70):
                px[x, y] = (0, 0, 0, 0)
    bbox = im.getbbox()
    im = im.crop(bbox)
    w, h = im.size
    tw = int(width)
    th = max(1, round(h * tw / w))
    small = im.resize((tw, th), Image.LANCZOS)
    # alpha netto e palette ridotta per l'aspetto pixel-art
    a = small.getchannel('A').point(lambda v: 255 if v > 110 else 0)
    rgb = small.convert('RGB').quantize(colors=40, method=Image.MEDIANCUT, dither=Image.NONE).convert('RGB')
    rgb.putalpha(a)
    # rimuove aloni magenta residui sui bordi
    p2 = rgb.load()
    for y in range(th):
        for x in range(tw):
            r, g, b, al = p2[x, y]
            if al and r > 170 and b > 150 and g < 110:
                p2[x, y] = (0, 0, 0, 0)
    rgb.save(out)
    print('saved', out, rgb.size)


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'gen':
        gen(*sys.argv[2:])
    elif cmd == 'proc':
        proc(*sys.argv[2:])
