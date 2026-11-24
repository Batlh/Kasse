"""Fügt Oberfläche, Rechenkern und Schrift zu einer einzigen build/index.html zusammen."""
import base64
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'src'
version = (root / 'VERSION').read_text(encoding='utf8').strip()

fonts = ''
for w in (500, 600, 700):
    b = base64.b64encode((src / 'fonts' / f'barlow-latin-{w}-normal.woff2').read_bytes()).decode()
    fonts += (f"@font-face{{font-family:Barlow;font-weight:{w};font-display:block;"
              f"src:url(data:font/woff2;base64,{b}) format('woff2')}}\n")

h = (src / 'index.tpl.html').read_text(encoding='utf8')
h = h.replace('/*__FONTS__*/', fonts).replace('/*__CSS__*/', (src / 'style.css').read_text(encoding='utf8'))
h = h.replace('/*__CORE__*/', (src / 'core.js').read_text(encoding='utf8'))
h = h.replace('/*__UI__*/', (src / 'ui.js').read_text(encoding='utf8'))
h = h.replace('__VERSION__', version)
(root / 'build').mkdir(exist_ok=True)
(root / 'build' / 'index.html').write_text(h, encoding='utf8')
print(f'build/index.html ({len(h) // 1024} KB), Version {version}')
