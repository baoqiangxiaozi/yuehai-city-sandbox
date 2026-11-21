"""Editable architectural interpretation, not surveyed reconstruction.
Run with Blender Python: blender -b --python generate_landmarks.py
or the bpy 5.0.1 Python environment documented in README.
No third-party image textures. Baseline model anchors are read-only inputs.
"""
import bpy, math, json, os, sys, struct, base64, hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
BASE=Path(os.environ.get('YUEHAI_BASE','/workspace/yuehai-sandbox-v2'))
if (BASE/'data/yuehai-osm.json').exists():
 DATA=json.loads((BASE/'data/yuehai-osm.json').read_text())
else:
 snapshot=json.loads((ROOT/'source-buildings.json').read_text())
 DATA={'buildings':[None]*(max(map(int,snapshot['buildings']))+1)}
 for index,b in snapshot['buildings'].items():DATA['buildings'][int(index)]=b
PLAN=.058; HS=.112; TAU=math.tau
OUT=ROOT/'assets'; OUT.mkdir(exist_ok=True)
MATS={
 'glass':('#243c3b',.56,.24), 'glass_alt':('#314e4c',.45,.22),
 'metal':('#a1aaa2',.8,.31), 'bronze':('#927247',.75,.34),
 'stone':('#283b33',.06,.79), 'roof':('#15251f',.25,.64),
 'night':('#26362d',.10,.38),
}
def rgba(h):
 v=[int(h[i:i+2],16)/255 for i in (1,3,5)]
 return tuple(x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in v)+(1,)
class Builder:
 def __init__(self): self.parts={}
 def face(self,key,vs):
  p,f=self.parts.setdefault(key,([],[])); n=len(p);p.extend(vs);f.append(tuple(range(n,n+len(vs))))
 def box(self,key,c,size,transform=None):
  x,y,z=c; a,b,h=[v/2 for v in size]
  pts=[(x+u*a,y+v*b,z+w*h) for u,v,w in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
  if transform: pts=[transform(p) for p in pts]
  for q in [(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)]: self.face(key,[pts[i] for i in q])
 def beam(self,key,a,b,r=.2):
  a=Vector(a);b=Vector(b);d=(b-a).normalized();u=d.cross(Vector((0,0,1)))
  if u.length<.01:u=d.cross(Vector((0,1,0)))
  u.normalize();u*=r/2;v=d.cross(u)
  p=[a-u-v,a+u-v,a+u+v,a-u+v,b-u-v,b+u-v,b+u+v,b-u+v]
  for q in [(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)]:self.face(key,[tuple(p[i]) for i in q])
 def prism(self,key,ring,z0,z1,transform=None):
  a=[(x,y,z0) for x,y in ring];b=[(x,y,z1) for x,y in ring]
  if transform:a=[transform(p) for p in a];b=[transform(p) for p in b]
  self.face(key,a[::-1]);self.face(key,b)
  for i in range(len(a)):j=(i+1)%len(a);self.face(key,[a[i],a[j],b[j],b[i]])
 def finish(self,col):
  obs=[]
  for key,(vs,fs) in self.parts.items():
   role,mat=key.split(':');me=bpy.data.meshes.new(role);me.from_pydata(vs,[],fs);me.update()
   ob=bpy.data.objects.new(role,me);col.objects.link(ob);me.materials.append(bpy.data.materials[mat]);ob['role']=role;ob['material_key']=mat;obs.append(ob)
  return obs

def reset(name):
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.context.preferences.filepaths.save_version=0
 col=bpy.data.collections.new(name);bpy.context.scene.collection.children.link(col)
 for name,(color,metal,rough) in MATS.items():
  m=bpy.data.materials.new(name);m.diffuse_color=rgba(color);m.use_nodes=True
  p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=rgba(color);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
  if name=='night':p.inputs['Emission Color'].default_value=(1,.64,.27,1);p.inputs['Emission Strength'].default_value=.22
 return col

def obb(b):
 ring=list(zip(b['p'][::2],b['p'][1::2]));best=None
 for i,a in enumerate(ring):
  bb=ring[(i+1)%len(ring)];ang=math.atan2(bb[1]-a[1],bb[0]-a[0]);c=math.cos(-ang);s=math.sin(-ang)
  xs=[x*c-z*s for x,z in ring];zs=[x*s+z*c for x,z in ring]
  w=max(xs)-min(xs);d=max(zs)-min(zs)
  if best is None or w*d<best[0]:best=(w*d,ang,w,d,(max(xs)+min(xs))/2,(max(zs)+min(zs))/2)
 _,ang,w,d,lx,lz=best
 if w<d:w,d=d,w;ang+=math.pi/2
 return dict(cx=lx*math.cos(ang)-lz*math.sin(ang),cz=lx*math.sin(ang)+lz*math.cos(ang),w=w,d=d,angle=ang,height=b['height'],levels=b['levels'],name=b['n'])

def tencent():
 col=reset('Tencent • architectural components');B=Builder()
 specs=[obb(DATA['buildings'][i]) for i in [602,603]]
 origin=[sum(s[k] for s in specs)/2 for k in ['cx','cz']]
 def trans(s):
  c=math.cos(s['angle']);ss=math.sin(s['angle'])
  return lambda p:(s['cx']-origin[0]+p[0]*c+p[1]*ss,-(s['cz']-origin[1]-p[0]*ss+p[1]*c),p[2])
 for n,s in enumerate(specs):
  T=trans(s);W=s['w'];D=s['d'];H=s['height'];f=H/s['levels'];hw=W/2;hd=D/2
  rad=min(2.4/PLAN,min(hw,hd)*.34)
  ring=[]
  for cx,cy,a in [(hw-rad,hd-rad,0),(-hw+rad,hd-rad,math.pi/2),(-hw+rad,-hd+rad,math.pi),(hw-rad,-hd+rad,1.5*math.pi)]:
   for j in range(6):q=a+j*math.pi/10;ring.append((cx+rad*math.cos(q),cy+rad*math.sin(q)))
  B.prism('Tower_envelope:glass',ring,0,H-5,T)
  B.box('Roof_deck:roof',(0,0,H-5),(W-2*rad,D-2*rad,.3),T)
  # Discrete faceted modules: true geometry, six repeatable projection variants,
  # inspired by facade consultant's 1.2m maximum cantilever (not exact panel schedule).
  nx=max(8,round((W-2*rad)/3));nz=s['levels'];bw=(W-2*rad)/nx
  for side in [-1,1]:
   for j in range(nz):
    z0=j*f+.32;z1=(j+1)*f-.18
    for i in range(nx):
     x0=-hw+rad+i*bw+.07;x1=x0+bw-.14
     projection=[.22,.45,.72,1.0,.55,.3][(i*7+j*3+n)%6]
     y=side*(hd+.06)
     # tilted box-panel face and metallic top shading lip
     v=[T(p) for p in [(x0,y,z0),(x1,y,z0),(x1,y+side*projection,z1),(x0,y+side*projection,z1)]]
     if side>0:v.reverse()
     B.face('Staggered_panels:'+('glass_alt' if (i+j)%5==0 else 'glass'),v)
     B.face('Panel_edges:metal',[T(p) for p in [(x0,y,z0),(x0+.09,y,z0),(x0+.09,y+side*projection,z1),(x0,y+side*projection,z1)]][::side])
     if j%2==0:B.face('Panel_shading:metal',[T(p) for p in [(x0,y+side*projection,z1),(x1,y+side*projection,z1),(x1,y+side*projection-side*.20,z1),(x0,y+side*projection-side*.20,z1)]][::side])
     if (i*13+j*17+n)%19<3:
      yy=y+side*projection*.62+side*.04;zz=z0+(z1-z0)*.6
      pts=[T(p) for p in [(x0+.35,yy,zz),(x1-.3,yy,zz),(x1-.3,yy+side*.06,zz+1.1),(x0+.35,yy+side*.06,zz+1.1)]]
      if side>0:pts.reverse()
      B.face('Night_windows:night',pts)
  # End elevations get ordered mullions, replacing bare end walls.
  for side in [-1,1]:
   for j in range(1,round((D-2*rad)/2)):
    y=-hd+rad+j*(D-2*rad)/round((D-2*rad)/2)
    B.beam('End_mullions:metal',T((side*(hw+.08),y,12)),T((side*(hw+.08),y,H-5)),.12)
  # Screened service crown remains below the original tower height.
  for j in range(9):
   for side in [-1,1]:B.box('Roof_louvers:metal',(0,side*(hd-.25),H-4.5+j*.48),(W-2*rad,.22,.15),T)
  B.box('Roof_service:roof',(0,0,H-2),(W*.58,D*.5,3.5),T)
  for side in [-1,1]:
   B.box('Roof_parapet:metal',(0,side*(hd-.5),H-.35),(W-2*rad,.4,.7),T)
  B.box('Lobby_glass:glass_alt',(0,0,6),(W*.96,D*.96,12),T)
  for xx in [-W*.3,0,W*.3]:
   B.box('Entry_portals:bronze',(xx,hd+1.1,5.8),(W*.15,2,1),T)
   for dx in [-W*.075,W*.075]:B.box('Entry_portals:bronze',(xx+dx,hd+.9,2.9),(.3,.35,5.8),T)
 # Bridge centerline follows baseline positions, not invented geographic placement.
 a=Vector((specs[0]['cx']-origin[0],-(specs[0]['cz']-origin[1]),0));b=Vector((specs[1]['cx']-origin[0],-(specs[1]['cz']-origin[1]),0));d=(b-a).normalized();side=Vector((-d.y,d.x,0));dist=(b-a).length
 floor=specs[0]['height']/specs[0]['levels']
 bridges=[(3*floor,6*floor,'Podium_link'),(21*floor,25*floor,'Health_link'),(35*floor,38*floor,'Knowledge_link')]
 for bi,(lo,hi,label) in enumerate(bridges):
  # Warm box portal wraps one tower and continues across to the other.
  p=a-d*(specs[0]['d']*.30 if bi==2 else 0);q=b+d*(specs[1]['d']*.30 if bi==1 else 0)
  width=20.69 if bi else 25
  def U(x,y,z):return tuple(p+d*x+side*y+Vector((0,0,z)))
  L=(q-p).length
  B.box(label+'_glass:glass_alt',(L/2,0,(lo+hi)/2),(L,width,hi-lo),lambda v:U(*v))
  # perimeter box frame and recessed soffit, no exposed toy truss outside glazing
  for yy in [-width/2-.16,width/2+.16]:
   for zz in [lo,hi]:B.beam('Bridge_portals:bronze',U(0,yy,zz),U(L,yy,zz),.72)
   for xx in [0,L]:B.beam('Bridge_portals:bronze',U(xx,yy,lo),U(xx,yy,hi),.85)
   for j in range(1,int(L/2.6)):
    xx=j*L/int(L/2.6);B.beam('Bridge_curtain:metal',U(xx,yy,lo+.5),U(xx,yy,hi-.5),.13)
   for k in range(1,max(2,round((hi-lo)/floor))):
    zz=lo+k*floor;B.beam('Bridge_curtain:bronze',U(0,yy,zz),U(L,yy,zz),.22)
   B.beam('Night_bridge_bands:night',U(.5,yy,lo+.9),U(L-.5,yy,lo+.9),.15)
  B.box('Bridge_soffits:roof',(L/2,0,lo-.2),(L,width,.4),lambda v:U(*v))
  # roof terrace insets / rooflights readable on near-camera orbit
  for xx in [L*.3,L*.6]:
   B.box('Bridge_rooflights:glass_alt',(xx,0,hi+.22),(L*.2,width*.46,.44),lambda v:U(*v))
   for yy in [-width*.41,width*.41]:B.box('Bridge_planters:stone',(xx,yy,hi+.3),(L*.22,1.4,.6),lambda v:U(*v))
 # Signature bronze portal sleeves around alternating tower elevations.
 for si,lo,hi in [(0,35*floor,38*floor),(1,21*floor,25*floor)]:
  s=specs[si];T=trans(s);w=s['w']/2;d=s['d']/2
  for side0 in [-1,1]:
   yy=side0*(d+.95)
   for zz in [lo,hi]:B.beam('Tower_portal_sleeves:bronze',T((-w,yy,zz)),T((w,yy,zz)),.85)
   for xx in [-w,w]:B.beam('Tower_portal_sleeves:bronze',T((xx,yy,lo)),T((xx,yy,hi)),.95)
 # Minimal entry terraces contained under the original envelopes; do not invent full city plaza.
 for s in specs:
  T=trans(s)
  for j in range(3):B.box('Entrance_steps:stone',(0,s['d']/2+1.5+j*.55,.12+j*.12),(s['w']*.50,4.2-j*.6,.24),T)
 obs=B.finish(col)
 meta={'id':'tencent-binhai','originRaw':origin,'scale':[PLAN,HS,PLAN],'buildings':specs,'baselineBuildingIndices':[602,603],
 'bridgeLevelsM':[{'name':q,'bottom':lo,'top':hi} for lo,hi,q in bridges],
 'caution':'Building heights/OBB from supplied OSM and existing JS. Mid/top bridge levels interpret B+H L21-25/L35-38 using south tower average floor height; lowest link L3-6 is illustrative. Not survey dimensions.'}
 return obs,meta

# Preserve baseline's silhouette dimensions; use an explicit profile with a denser
# geometric facade, not JS geometry export. Radius in original scene units.
PROFILE=[(0,1.88),(.03,2.06),(.09,2.13),(.20,2.10),(.34,2.02),(.50,1.90),(.64,1.73),(.76,1.50),(.86,1.20),(.92,.95),(.96,.65),(.985,.36),(.997,.16),(1,0)]
def cr():
 col=reset('China Resources • architectural components');B=Builder();b=DATA['buildings'][423]
 origin=[sum(b['p'][i::2])/len(b['p'][i::2]) for i in [0,1]]
 H=b['height'];base=1.05/HS;shaft=H-base
 def radius(t):
  for (a,x),(bb,y) in zip(PROFILE[:-1],PROFILE[1:]):
   if t<=bb:return (x+(y-x)*(t-a)/(bb-a))/PLAN
  return PROFILE[-1][1]/PLAN
 def P(t,a,off=0):r=radius(t)+off;return (r*math.cos(a),r*math.sin(a),base+t*shaft)
 # 56-column aligned faceting is real geometry; crown triangles continue the framework.
 rings=sorted(set([j/68 for j in range(69)]+[t for t,r in PROFILE]+[.82,.92,.96,.985]))
 for j,(t0,t1) in enumerate(zip(rings[:-1],rings[1:])):
  for i in range(56):
   a=i/56*TAU;aa=(i+1)/56*TAU
   key='Crown_facets:glass_alt' if t0>=.82 and (i+j)%3==0 else 'Tower_envelope:glass'
   q=[P(t0,a),P(t0,aa),P(t1,aa),P(t1,a)]
   if t0>=.82:
    B.face(key,[q[0],q[1],q[2]]);B.face(key,[q[0],q[2],q[3]])
   else:B.face(key,q)
 # 56 tangible external columns, base paired into 28 feet, upper into 28 crown ribs.
 for i in range(56):
  a=i/56*TAU;paired=(i//2+.25)/28*TAU
  # forked entrance supports, same main envelope height rather than baseline 16 sticks
  foot=(radius(0)*math.cos(paired),radius(0)*math.sin(paired),.3)
  B.beam('Entrance_diagrid:metal',foot,P(.075,a,.26),.7)
  column_rings=[.075]+[t for t,r in PROFILE if .075<t<.82]+[.82]
  for t0,t1 in zip(column_rings[:-1],column_rings[1:]):
   B.beam('External_columns:metal',P(t0,a,.30),P(t1,a,.30),.33)
  B.beam('Crown_transition:metal',P(.82,a,.32),P(.92,paired,.32),.38)
 # 28 crown ribs merge to the spire, with diagonal lattice and triangular panels.
 for i in range(28):
  a=(i+.25)/28*TAU;aa=(i+1.25)/28*TAU
  for t0,t1 in zip([.92,.96,.985,.997],[.96,.985,.997,1]):B.beam('Crown_ribs:metal',P(t0,a,.30),P(t1,a,.30),.38 if t0<.985 else .26)
  B.beam('Crown_diagrid:metal',P(.82,a,.38),P(.92,aa,.38),.2)
  B.beam('Crown_diagrid:metal',P(.92,a,.38),P(.96,aa,.38),.16)
 # Slender floor joints, technical belts and a warm crown on separate night role.
 for j in range(2,66):
  t=j/68
  if t>.88:continue
  for i in range(56):B.face('Floor_joints:roof',[P(t,i/56*TAU,.10),P(t,(i+1)/56*TAU,.10),P(t+.0006,(i+1)/56*TAU,.10),P(t+.0006,i/56*TAU,.10)])
 for t in [.30,.58,.82]:
  for dt in [-.002,.002]:
   for i in range(112):B.beam('Technical_belts:metal',P(t+dt,i/112*TAU,.28),P(t+dt,(i+1)/112*TAU,.28),.24)
 for j in range(3,60):
  t=j/68
  for i in range(56):
   if (i*13+j*17)%29<3:
    a=(i+.17)/56*TAU;aa=(i+.75)/56*TAU
    B.face('Night_windows:night',[P(t,a,.08),P(t,aa,.08),P(t+.004,aa,.08),P(t+.004,a,.08)])
 # Recessed lobby, 28 paired-column entrance portals; explicitly no interiors.
 lobbyR=radius(0)*.91
 ring=[(lobbyR*math.cos(i/112*TAU),lobbyR*math.sin(i/112*TAU)) for i in range(112)]
 B.prism('Recessed_lobby:glass_alt',ring,0,base+7)
 for i in range(28):
  a=(i+.5)/28*TAU;r=lobbyR+.1
  for da in [-.016,.016]:B.beam('Entrance_frames:bronze',(r*math.cos(a+da),r*math.sin(a+da),.2),(r*math.cos(a+da),r*math.sin(a+da),6.8),.18)
  B.beam('Entrance_frames:bronze',(r*math.cos(a-.016),r*math.sin(a-.016),6.8),(r*math.cos(a+.016),r*math.sin(a+.016),6.8),.2)
  B.beam('Night_lobby:night',(r*math.cos(a-.018),r*math.sin(a-.018),6.3),(r*math.cos(a+.018),r*math.sin(a+.018),6.3),.25)
  for t in [.90,.935]:B.beam('Night_crown:night',P(t,a,.12),P(t+.025,a,.12),.24)
 # Compact entrance steps, no oversized cylindrical podium masking the diagrid.
 for j in range(3):
  rr=lobbyR+1.1-j*.3;ring=[(rr*math.cos(i/112*TAU),rr*math.sin(i/112*TAU)) for i in range(112)]
  B.prism('Entrance_terraces:stone',ring,j*.12,(j+1)*.12)
 obs=B.finish(col)
 # Terminate the finite-thickness spire at the original overall height.
 for ob in obs:
  for v in ob.data.vertices:v.co.z=min(H,max(0,v.co.z))
 return obs,{'id':'china-resources','originRaw':origin,'scale':[PLAN,HS,PLAN],'baselineBuildingIndices':[423],'heightM':H,'caution':'392.5m height, centre and radial envelope preserved from supplied baseline. 56-to-28 framework based on KPF design description. Panel layouts, section sizes and door positions are architectural interpretation, not measured reconstruction.'}

def export_compact(obs,meta,path):
 # Explicit Y-up meter coordinates. Matrix matches Blender glTF exporter axis conversion.
 meshes=[];tri=0
 for ob in obs:
  me=ob.data;me.calc_loop_triangles();vs=[];ns=[];idx=[];dedup={}
  for t in me.loop_triangles:
   for li in t.loops:
    l=me.loops[li];p=me.vertices[l.vertex_index].co;n=me.corner_normals[li].vector
    key=tuple(round(x,6) for x in (*p,*n))
    if key not in dedup:
     dedup[key]=len(vs)//3;vs.extend((p.x,p.z,-p.y));ns.extend((n.x,n.z,-n.y))
    idx.append(dedup[key])
  def b64(a,fmt):return base64.b64encode(struct.pack('<'+fmt*len(a),*a)).decode()
  meshes.append({'name':ob.name,'material':ob['material_key'],'position':b64(vs,'f'),'normal':b64([max(-127,min(127,round(v*127))) for v in ns],'b'),'normalType':'int8','index':b64(idx,'H' if len(vs)//3<65536 else 'I'),'indexType':'uint16' if len(vs)//3<65536 else 'uint32','vertices':len(vs)//3,'triangles':len(idx)//3,'night':ob['material_key']=='night'})
  tri+=len(idx)//3
 payload={'format':'yuehai-inline-mesh-v1','axis':'X=baseline east, Y=up, Z=baseline south; metres','metadata':meta,'materials':{k:{'color':v[0],'metalness':v[1],'roughness':v[2],'night':k=='night'} for k,v in MATS.items()},'meshes':meshes}
 path.write_text(json.dumps(payload,separators=(',',':')))
 return tri,len(meshes),len(set(ob['material_key'] for ob in obs))

def stage(obs,name):
 scene=bpy.context.scene;studio=bpy.data.collections.new('STUDIO • not exported');scene.collection.children.link(studio)
 bounds=[ob.matrix_world@Vector(p) for ob in obs for p in ob.bound_box];lo=Vector(tuple(min(p[i] for p in bounds) for i in range(3)));hi=Vector(tuple(max(p[i] for p in bounds) for i in range(3)));center=(lo+hi)/2;H=hi.z
 scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
 scene.render.resolution_x=1200;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
 scene.world=bpy.data.worlds.new('Deep green ambient');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.18,.24,.21,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.65
 scene.view_settings.view_transform='AgX'
 def move_collection(ob):
  for c in list(ob.users_collection):c.objects.unlink(ob)
  studio.objects.link(ob)
 bpy.ops.mesh.primitive_plane_add(size=H*200,location=(0,0,-.12));floor=bpy.context.object;floor.name='Studio ground (not asset)';move_collection(floor);floor.data.materials.append(bpy.data.materials['stone'])
 for title,pos,energy,size,color in [('Key',(H*.6,-H*.7,H*.95),H*H*65,H*.9,(1,.88,.70)),('Fill',(-H*.7,-H*.1,H*.60),H*H*32,H*.7,(.61,.78,1)),('Rim',(H*.3,H*.6,H*.85),H*H*95,H*.6,(.76,1,.90))]:
  d=bpy.data.lights.new(title,'AREA');d.energy=energy;d.shape='DISK';d.size=size;d.color=color;o=bpy.data.objects.new(title,d);studio.objects.link(o);o.location=pos;o.rotation_euler=(center-o.location).to_track_quat('-Z','Y').to_euler()
 cd=bpy.data.cameras.new('Camera');cam=bpy.data.objects.new('Camera',cd);studio.objects.link(cam);scene.camera=cam;cd.type='ORTHO'
 # Camera looks at both long elevations of Tencent; CR gets low oblique architectural view.
 direction=Vector((1.5,.6,.65)) if name=='tencent-binhai' else Vector((1.15,-1.55,.55))
 cam.location=center+direction.normalized()*H*2;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();cd.ortho_scale=max(H*1.21,(hi.x-lo.x)*1.5)
 scene.render.filepath=str(OUT/(name+'-overall.png'))
 bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(name+'.blend')),compress=True)
 bpy.ops.render.render(write_still=True)
 # A distinct near view demonstrates real geometry in the revised bridges/crown.
 target=Vector((0,0,H*.65)) if name=='tencent-binhai' else Vector((0,0,H*.88))
 cam.location=target+direction.normalized()*H;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cd.ortho_scale=H*(.52 if name=='tencent-binhai' else .36)
 scene.render.filepath=str(OUT/(name+'-detail.png'));bpy.ops.render.render(write_still=True)
 return {'min':list(lo),'max':list(hi)}

def main():
 stats=[]
 for fn in [tencent,cr]:
  obs,meta=fn();name=meta['id'];meta['blenderVersion']=bpy.app.version_string
  for ob in obs:ob['landmark_id']=name;ob['units']='metres';ob['interpretation']='Architectural study; not surveyed'
  bpy.ops.object.select_all(action='DESELECT')
  for ob in obs:ob.select_set(True)
  bpy.context.view_layer.objects.active=obs[0]
  bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_cameras=False,export_lights=False,export_materials='EXPORT')
  tri,objects,mats=export_compact(obs,meta,OUT/(name+'.inline.json'))
  bounds=stage(obs,name)
  s={'id':name,'triangles':tri,'objects':objects,'materials':mats,'glbBytes':(OUT/(name+'.glb')).stat().st_size,'inlineBytes':(OUT/(name+'.inline.json')).stat().st_size,'boundsBlenderM':bounds,**meta};stats.append(s)
  print('ASSET_COMPLETE',json.dumps(s),flush=True)
 (ROOT/'manifest.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
