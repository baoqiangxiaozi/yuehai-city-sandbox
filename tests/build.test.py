"""Rebuild/static validation only; no browser or network access."""
from pathlib import Path
from html.parser import HTMLParser
import hashlib,json,subprocess,sys
ROOT=Path(__file__).resolve().parents[1]
def build():
    subprocess.run([sys.executable,str(ROOT/'scripts/build_page.py')],cwd=ROOT,check=True)
    return (ROOT/'index.html').read_bytes()
a=build();b=build();assert a==b,'non-reproducible build'
class HTML(HTMLParser):
    def __init__(self):super().__init__();self.scripts=[];self.current=None;self.ids=[]
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if 'id' in attrs:self.ids.append(attrs['id'])
        if tag=='script':
            assert 'src' not in attrs,'runtime external script'
            self.current=[attrs,''];self.scripts.append(self.current)
    def handle_endtag(self,tag):
        if tag=='script':self.current=None
    def handle_data(self,s):
        if self.current is not None:self.current[1]+=s
p=HTML();p.feed(a.decode());assert len(p.ids)==len(set(p.ids))
assert len(p.scripts)==9,(len(p.scripts),'expected watchdog/Three/2JSON/loader/refined/roam/LOD/app')
asset_dir=ROOT/'landmarks/assets'
assets=[json.loads(path.read_text()) for path in sorted(asset_dir.glob('*.inline.json'))]
expected={'osm-data':json.loads((ROOT/'data/yuehai-osm.json').read_text()),'landmark-assets':assets}
for attrs,text in p.scripts:
    if attrs.get('type')=='application/json':
        assert json.loads(text)==expected[attrs['id']];continue
    cp=subprocess.run(['node','-e',"const vm=require('vm');let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>new vm.Script(s));"],input=text,text=True,capture_output=True)
    assert cp.returncode==0,cp.stderr
text=a.decode()
for token in ['/*__THREE__*/','/*__ROAM__*/','/*__LOD__*/','/*__REFINED__*/','/*__LANDMARK_LOADER__*/','/*__CSS__*/','/*__JS__*/','__OSM_DATA__','/*__LANDMARK_JSON__*/','__TENCENT_ASSET__','__CR_ASSET__','实时统计','实时间隔']:
    assert token not in text,token
for label in ['模拟车流量','模拟均速','普通楼程序化示意','进入第一人称 · 自由漫游','返回总览']:assert label in text,label
assert hashlib.sha256((ROOT/'vendor/three.min.js').read_bytes()).hexdigest()=='9274bbcec8d96168626c732b5d31c775aa8cfb7eaa0599bec0c175908a2c1ce2'
assert hashlib.sha256((ROOT/'data/yuehai-osm.json').read_bytes()).hexdigest()=='8b621052a50f7ce7c66328f8d9532a5dd521296f8416d199ddbdf6a80f8e670d'
print('PASS deterministic build, every inline script parsed, OSM and landmark JSON equal source, unique IDs, no external script tags, simulation labels, r128/data hashes')
print('HTML',len(a),'SHA256',hashlib.sha256(a).hexdigest())
