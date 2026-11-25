# -*- coding: utf-8 -*-
"""Assemble the single-file Yuehai sandbox from the source pieces."""
import json, os, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
shell = open(os.path.join(ROOT, 'src', 'yuehai.shell.html'), encoding='utf-8').read()
css = open(os.path.join(ROOT, 'src', 'yuehai.css'), encoding='utf-8').read()
js = open(os.path.join(ROOT, 'src', 'yuehai.js'), encoding='utf-8').read()
lod = open(os.path.join(ROOT, 'src', 'yuehai.lod.js'), encoding='utf-8').read()
landmark_loader = open(os.path.join(ROOT, 'landmarks', 'inline-loader.js'), encoding='utf-8').read()
refined = open(os.path.join(ROOT, 'src', 'yuehai.refined.js'), encoding='utf-8').read()
asset_dir = os.path.join(ROOT, 'landmarks', 'assets')
asset_paths = sorted(p for p in os.listdir(asset_dir) if p.endswith('.inline.json'))
assets = [json.loads(open(os.path.join(asset_dir, name), encoding='utf-8').read()) for name in asset_paths]
landmark_assets = json.dumps(assets, ensure_ascii=False, separators=(',', ':'))
data_text = open(os.path.join(ROOT, 'data', 'yuehai-osm.json'), encoding='utf-8').read()
three_path = os.path.join(ROOT, 'vendor', 'three.min.js')
three = open(three_path, encoding='utf-8').read()
data = json.loads(data_text)  # validates JSON

# escape sequences that could terminate an inline script container
data_text = data_text.replace('</script', '<\\/script')
js = js.replace('/*__NEXT__*/', '')
js = js.replace('</script', '<\\/script')
lod = lod.replace('</script', '<\\/script')
landmark_loader = landmark_loader.replace('</script', '<\\/script')
refined = refined.replace('</script', '<\\/script')
landmark_assets = landmark_assets.replace('</script', '<\\/script')
three = three.replace('</script', '<\\/script')

html = (
    shell
    .replace('/*__CSS__*/', css)
    .replace('/*__THREE__*/', three)
    .replace('/*__LOD__*/', lod)
    .replace('/*__LANDMARK_LOADER__*/', landmark_loader)
    .replace('/*__REFINED__*/', refined)
    .replace('/*__LANDMARK_JSON__*/', landmark_assets)
    .replace('/*__JS__*/', js)
    .replace('__OSM_DATA__', data_text)
)
out = os.path.join(ROOT, 'index.html')
with open(out, 'w', encoding='utf-8', newline='') as fh:
    fh.write(html)

three_sha = hashlib.sha256(open(three_path, 'rb').read()).hexdigest()
print('wrote', out)
print('html bytes', os.path.getsize(out))
print('JSON bytes', os.path.getsize(os.path.join(ROOT, 'data', 'yuehai-osm.json')))
print('three bytes', os.path.getsize(three_path), 'sha256', three_sha)
print('landmark assets', len(assets))
print('output counts', data['meta']['counts']['output'])
