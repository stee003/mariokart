// ID-scoped art direction. No legacy theme/track is changed by this module.
// Near/middle/far scenery, readable mechanics, instanced repeated details and
// time-based animation. No external assets, per-frame randoms or extra lights.
import * as THREE from '../lib/three.module.js';
import { standard, glow, yaw, at, mesh, batcher, clearOfRoad, fascia, sign, atmosphere } from './expeditionEnvironment.js';
import { flameHazardRadius } from './track.js';

function kit(sky, fog, ground, road, accent, dark, sun, depth = 5) {
  return {
    refinedRoad: true, road2: true, sky, fog, ground, groundDepth: depth,
    road, curbA: accent, curbB: dark, shoulder: road.map(v => v * .72),
    edge: new THREE.Color(accent).toArray(),
    hemi: [0xe0edff, dark, 1.2], sun: [sun, 1.5], sunPos: [-160, 220, -100],
    banner: { bg: '#172433', stripe: `#${accent.toString(16).padStart(6,'0')}`, text: '#fff4df' },
  };
}
export const REFINEMENT_KITS = {
  forge_line: kit(['#171e31','#414554','#99745d','#e5ac75'], [0x8b7770,230,780], 0x45434a, [.32,.35,.39], 0xffc778, 0x343c49, 0xffd5a4),
  skyreach: kit(['#2867ad','#76b5df','#d5ecee','#fff0d0'], [0xc2dfec,330,1000], null, [.44,.52,.55], 0xffedb8, 0x467f91, 0xffe6bc),
  ruins_of_vael: kit(['#2c646b','#6eaaa0','#cbdbbd','#ffe1ae'], [0xadc4ac,200,730], 0x586e57, [.48,.48,.39], 0xcce8b3, 0x647166, 0xffe2af),
  sandstone_crown: kit(['#675976','#ca8d81','#edbd91','#ffe0ad'], [0xd8ad89,260,860], 0xb78a60, [.56,.42,.29], 0xffdf9b, 0x915c49, 0xffdbaf),
  tempest_ridge: { ...kit(['#182c49','#3d566e','#829397','#d1c7a9'], [0x6c8592,180,680], 0x3c5155, [.28,.36,.40], 0xffd791, 0x365268, 0xd2e5f5, 12), wet: true },
  glimmer_deep: kit(['#090f2b','#1c2547','#374364','#516f79'], [0x253b58,170,620], 0x253743, [.30,.35,.43], 0x8cf5e0, 0x504372, 0xbadcea, 8),
  orbital_ring: { ...kit(['#020616','#050d22','#0c1e3b','#1e385b'], [0x172e50,500,1500], null, [.31,.39,.48], 0x90f5ed, 0x30466a, 0xe3f4ff), stars: true },
  void_terminal: { ...kit(['#050719','#11132b','#221c37','#3b294b'], [0x29243f,340,1100], null, [.31,.32,.42], 0xe3b3ff, 0x473759, 0xc8d5f5), stars: true },
};
const BOX = new THREE.BoxGeometry(1,1,1);
const ROCK = new THREE.IcosahedronGeometry(1,1);
const CONE = new THREE.ConeGeometry(1,1,7);
const CYL = new THREE.CylinderGeometry(1,1,1,10);
const V = (x,y,z) => new THREE.Vector3(x,y,z);

// Shallow sealed decks rather than walls reaching into a nonexistent ground.
function deck(group, samples, color, closed = true, apron = 2.6) {
  const vertices=[], indices=[];
  const count=closed?samples.length+1:samples.length;
  for(let i=0;i<count;i++) {
    const p=samples[i%samples.length], w=p.width/2+apron;
    for(const [x,y] of [[-w,0],[-w,-2.5],[w,-2.5],[w,0]]) {
      const v=at(p,x,y); vertices.push(v.x,v.y,v.z);
    }
    if(i) for(let j=0;j<3;j++) {
      const n=i*4+j; indices.push(n-4,n,n+1,n-4,n+1,n-3);
    }
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setIndex(indices);geo.computeVertexNormals();
  const mat=standard(color);mat.side=THREE.DoubleSide;
  mesh(group,'Suspended deck hull',geo,mat,V(0,0,0));
}
function arch(b,p,material,accent,height=11,name='Sector portal') {
  const w=p.width/2+3.8;
  for(const side of [-1,1]) {
    b.add(`${name} piers`,BOX,material,at(p,side*w,height/2),[1.1,height,1.8],yaw(p));
    b.add(`${name} inlays`,BOX,accent,at(p,side*(w-.58),height*.62),[.12,3.5,1.85],yaw(p));
  }
  b.add(`${name} lintel`,BOX,material,at(p,0,height),[w*2+1.1,1.2,2],yaw(p));
  b.add(`${name} light`,BOX,accent,at(p,0,height-.64),[w*1.7,.10,.8],yaw(p));
}
// Wide, route-following tunnels. Solid pieces have camera collision; the
// vaulted roof stays well above jumps and never shortcuts across a bend.
function tunnel(group,track,b,colliders,mat,light,crystal=false) {
  if(!track.tunnelRange) return;
  const [start,end]=track.tunnelRange;
  for(let s=start;s<=end;s+=9) {
    const p=track.pointAt(s), w=p.width/2+3.8, h=crystal?15:12;
    arch(b,p,mat,light,h,crystal?'Geode vault':'Gallery ribs');
    const roof=mesh(group,'Gallery roof',new THREE.BoxGeometry(w*2+2,1.1,9.5),mat,at(p,0,h+.4));roof.rotation.y=yaw(p);
    colliders.push(new THREE.Box3().setFromObject(roof));
    for(const side of [-1,1]) {
      const wall=mesh(group,'Gallery wall',new THREE.BoxGeometry(1,h,9.5),mat,at(p,side*(w+.2),h/2));wall.rotation.y=yaw(p);
      colliders.push(new THREE.Box3().setFromObject(wall));
    }
  }
}
function furniture(group,track,b,kit,state) {
  const metal=standard(kit.curbB), light=glow(kit.curbA), pale=standard(0xa3b0b5);
  for(let s=8;s<track.L;s+=14) {
    const p=track.pointAt(s), sc=track.def.shortcut, f=s/track.L;
    if(sc&&f>sc.entry-.02&&f<sc.exit+.02) continue;
    for(const side of [-1,1]) {
      b.add('Route bollards',BOX,metal,at(p,side*(p.width/2+1.8),.55),[.25,1.1,.3],yaw(p));
      b.add('Route reflectors',BOX,light,at(p,side*(p.width/2+1.8),1),[.35,.22,.4],yaw(p));
      b.add('Shoulder running lights',BOX,light,at(p,side*(p.width/2+.75),.1),[.15,.10,3.2],yaw(p));
    }
  }
  for(const [i,f] of [.06,.29,.56,.82].entries()) sign(group,track.pointAt(f*track.L),-1,`0${i+1}`,kit.banner.stripe);
  for(let f=.08;f<.98;f+=.047) {
    // Camera-right is -p.right: a positive cross reads as a right turn.
    const p=track.pointAt(f*track.L), q=track.pointAt(f*track.L+25), cross=p.dir.x*q.dir.z-p.dir.z*q.dir.x;
    if(Math.abs(cross)>.28) sign(group,p,cross>0?1:-1,cross>0?'››':'‹‹',kit.banner.stripe);
  }
  // Mechanic entry/exit language: approach warning, paired beacons, arrows.
  for(const zone of track.def.zones) {
    sign(group,track.pointAt(zone.f0*track.L-24),-1,zone.type==='wind'?'≈':zone.type==='lowgrav'?'↑':'»',kit.banner.stripe);
    for(const f of [zone.f0,zone.f1]) {
      const p=track.pointAt(f*track.L);
      for(const side of [-1,1]) {
        b.add('Zone beacons',BOX,metal,at(p,side*(p.width/2+3),2.8),[.5,5.6,.5],yaw(p));
        b.add('Zone beacon lamps',BOX,light,at(p,side*(p.width/2+3),5.5),[.8,.5,.8],yaw(p));
      }
    }
    if(zone.type==='lowgrav') for(let f=zone.f0;f<=zone.f1;f+=.035) {
      const p=track.pointAt(f*track.L);
      const ring=mesh(group,'Updraft halo',new THREE.TorusGeometry(1,.012,5,32,Math.PI),light,at(p,0,.2));
      ring.scale.set(p.width/2+2.3,11,1);ring.rotation.y=yaw(p);
    }
  }
  if(track.shortcut) {
    const sc=track.def.shortcut;
    sign(group,track.pointAt(sc.entry*track.L-16),sc.latEntry<0?-1:1,sc.latEntry<0?'↗':'↖',kit.banner.stripe);
    for(let i=3;i<track.shortcut.samples.length-3;i+=8) {
      const p=track.shortcut.samples[i];
      for(const side of [-1,1]) b.add('Shortcut studs',BOX,light,at(p,side*(track.shortcut.halfW-.25),.12),[.25,.18,1.4],yaw(p));
    }
  }
  // Tell the player where a hazard operates, synchronized with actual physics.
  for(const [i,o] of track.obstacles.entries()) {
    const spec=track.def.obstacles[i], p=track.pointAt(spec.s*track.L);
    sign(group,track.pointAt(spec.s*track.L-28),-1,'!',kit.banner.stripe);
    if(o.type==='pendulum') {
      arch(b,p,metal,light,10,'Hazard gantry');
      const cable=mesh(group,'Moving suspension',BOX,pale,at(p,0,6));
      state.extras.push(()=>{
        const top=at(p,spec.lat||0,9.5), bottom=o.pos.clone().add(V(0,1.5,0));
        cable.position.copy(top).add(bottom).multiplyScalar(.5);
        cable.scale.set(.12,top.distanceTo(bottom),.12);
        cable.quaternion.setFromUnitVectors(V(0,1,0),top.sub(bottom).normalize());
      });
    }
    if(o.type==='flamejet') {
      // Ring sized to the flame cone's real footprint (see flameHazardRadius)
      // so the painted warning matches the collider exactly.
      const burn=flameHazardRadius(o.radius);
      const halo=mesh(group,'Vent warning ring',new THREE.RingGeometry(burn*.86,burn,24),glow(0xffcd86),at(p,spec.lat,.09));halo.rotation.x=-Math.PI/2;
      state.extras.push(()=>halo.material.color.setHex(o.active?0xff7459:0xffdca0));
    }
  }
}
function scatter(track,rnd,count,min,max,radius,place) {
  for(let i=0;i<count;i++) {
    const p=track.pointAt(rnd()*track.L), v=at(p,(rnd()<.5?-1:1)*(p.width/2+min+rnd()*(max-min)));
    if(clearOfRoad(track,v,radius)) place(v,p,i);
  }
}
function ridge(b,rnd,floor,mat,name,scale=1) {
  const mesa=new THREE.CylinderGeometry(.68,1,1,9,3);
  const peak=new THREE.ConeGeometry(1,1,9,3);
  // Broken ridges and strata rather than perfectly repeated cones/frustums.
  for(const geo of [mesa,peak]) {
    const a=geo.attributes.position;
    for(let i=0;i<a.count;i++) {
      const x=a.getX(i),y=a.getY(i),z=a.getZ(i);
      const r=1+Math.sin(x*9+z*7+y*17)*.12;
      a.setXYZ(i,x*r+y*.16,y,z*r+y*.12);
    }
    geo.computeVertexNormals();
  }
  for(let i=0;i<32;i++) {
    const a=i/32*Math.PI*2, r=440+rnd()*110,h=(40+rnd()*85)*scale;
    const geo=name==='Desert mesa horizon'?mesa:peak;
    b.add(name,geo,mat,V(Math.cos(a)*r,floor+h*.45,Math.sin(a)*r),[55+rnd()*45,h,45+rnd()*30],a);
  }
}

function forge(group,track,rnd,state,b,floor,colliders) {
  const steel=standard(0x485968), copper=standard(0xa77955), concrete=standard(0x66666b), hot=glow(0xffbc67);
  tunnel(group,track,b,colliders,steel,hot);
  // A real works district: repetitive sheds, clerestory windows, stacks,
  // loading aprons and overhead pipes, all outside the drivable envelope.
  scatter(track,rnd,65,30,145,19,(v,p,i)=>{
    const h=9+rnd()*24;v.y=floor;
    b.add('Foundry sheds',BOX,steel,v.clone().add(V(0,h/2,0)),[22,h,16],yaw(p));
    b.add('Foundry clerestories',BOX,hot,v.clone().add(V(0,h*.72,0)),[22.2,1.5,16.2],yaw(p));
    b.add('Foundry roof caps',BOX,concrete,v.clone().add(V(0,h+.5,0)),[24,1,18],yaw(p));
    if(i%2===0) {
      b.add('Copper exhaust stacks',CYL,copper,v.clone().add(V(5,h+10,0)),[2,22,2]);
      b.add('Stack warning bands',CYL,hot,v.clone().add(V(5,h+18,0)),[2.04,.6,2.04]);
    }
  });
  // Service machinery at the track edge adds human-scale detail between sheds.
  scatter(track,rnd,65,12,50,5,(v,p,i)=>{
    v.y=floor;
    b.add('Heat exchanger tanks',CYL,copper,v.clone().add(V(0,3.5,0)),[2.5,7,2.5]);
    for(const h of [1,5.5]) b.add('Tank reinforcement bands',CYL,steel,v.clone().add(V(0,h,0)),[2.65,.35,2.65]);
    b.add('Tank service plinths',BOX,concrete,v.clone().add(V(0,.3,0)),[6,.6,6],yaw(p));
    b.add('Valve housings',BOX,hot,v.clone().add(V(0,4,2.6)),[1,.5,.4]);
  });
  for(const f of [.08,.57,.9]) arch(b,track.pointAt(f*track.L),steel,hot,14,'Pipe bridge');
  for(let s=12;s<track.L;s+=18) {
    const p=track.pointAt(s);
    for(const side of [-1,1]) b.add('Loading dock footings',BOX,concrete,at(p,side*(p.width/2+2),-2),[2,4,4],yaw(p));
  }
  // Animated conveyor strips correspond exactly to the current zone.
  for(const zone of track.def.zones) if(zone.type==='current') {
    const belt=new THREE.InstancedMesh(BOX,hot,36);belt.name='Moving conveyor guides';group.add(belt);const d=new THREE.Object3D();
    state.extras.push((dt,time)=>{
      for(let i=0;i<36;i++) {
        const f=zone.f0+((i/36+time*.035)%1)*(zone.f1-zone.f0),p=track.pointAt(f*track.L);
        d.position.copy(at(p,(i%2?1:-1)*(p.width/2-2),.08));d.rotation.set(0,yaw(p),0);d.scale.set(.35,.04,1.8);d.updateMatrix();belt.setMatrixAt(i,d.matrix);
      }
      belt.instanceMatrix.needsUpdate=true;
    });
  }
  const v=V(20,floor,15);
  mesh(group,'Central blast furnace',new THREE.CylinderGeometry(12,19,48,16),steel,v.clone().add(V(0,24,0)));
  for(const h of [8,24,40]) {
    const ring=mesh(group,'Furnace copper bands',new THREE.TorusGeometry(17-h*.1,.7,6,32),copper,v.clone().add(V(0,h,0)));ring.rotation.x=Math.PI/2;
  }
  mesh(group,'Furnace heart',new THREE.CylinderGeometry(12.2,12.2,3,16),hot,v.clone().add(V(0,46,0)));
  const smokeMat=new THREE.MeshBasicMaterial({color:0x727884,transparent:true,opacity:.18,depthWrite:false});
  const smoke=new THREE.InstancedMesh(ROCK,smokeMat,12);smoke.name='Foundry steam plume';group.add(smoke);const d=new THREE.Object3D();
  state.extras.push((dt,t)=>{for(let i=0;i<12;i++){const h=(t*2+i*6)%72;d.position.copy(v).add(V(h*.3,52+h,0));d.scale.setScalar(5+h*.14);d.updateMatrix();smoke.setMatrixAt(i,d.matrix);}smoke.instanceMatrix.needsUpdate=true;});
  atmosphere(group,state,rnd,0xffd196,100,floor,60,1.6);
}

function skyreach(group,track,rnd,state,b) {
  const rock=standard(0x667889), turf=standard(0x75a894), ivory=standard(0xe1d8bd), teal=standard(0x477e8b), gold=glow(0xffe3a1);
  // Road-bearing islands: broad shelves directly beneath the route, tapering
  // to hanging rock. Their grassy upper surface remains below the road.
  for(let s=15;s<track.L;s+=37) {
    const p=track.pointAt(s),r=p.width/2+7;
    b.add('Floating island shelves',ROCK,rock,at(p,0,-13),[r,10,24],yaw(p));
    b.add('Island moss crowns',ROCK,turf,at(p,0,-4.5),[r,3,23],yaw(p));
  }
  scatter(track,rnd,70,35,190,22,(v,p,i)=>{
    const r=10+rnd()*16;v.y=-15+rnd()*40;
    b.add('Satellite floating isles',ROCK,rock,v,[r,r*1.4,r*.8],i);
    b.add('Satellite island meadows',ROCK,turf,v.clone().add(V(0,r*1.15,0)),[r*.85,3,r*.7],i);
    b.add('Sky cypress',CONE,teal,v.clone().add(V(0,r*1.15+6,0)),[2,12,2],i);
  });
  // A navigational lighthouse, tall enough to read throughout the lap.
  const v=V(0,10,-15);
  mesh(group,'Sky beacon island',ROCK,rock,v.clone().add(V(0,-18,0))).scale.set(27,30,24);
  mesh(group,'Sky beacon tower',new THREE.CylinderGeometry(5,8,39,12),ivory,v.clone().add(V(0,12,0)));
  mesh(group,'Sky beacon lantern',new THREE.CylinderGeometry(6,6,5,12),gold,v.clone().add(V(0,34,0)));
  mesh(group,'Sky beacon roof',new THREE.ConeGeometry(9,7,12),teal,v.clone().add(V(0,40,0)));
  for(const f of [.12,.56,.88]) arch(b,track.pointAt(f*track.L),ivory,gold,12,'Sky aqueduct');
  const cloudMat=new THREE.MeshBasicMaterial({color:0xe5eff1,transparent:true,opacity:.62,depthWrite:false});
  for(let i=0;i<42;i++) {
    const a=i/42*Math.PI*2,r=280+rnd()*220;
    b.add('Cloud sea',ROCK,cloudMat,V(Math.cos(a)*r,-30-rnd()*15,Math.sin(a)*r),[40+rnd()*35,9+rnd()*7,30+rnd()*25],a);
  }
  // Pennants indicate the updraft without obstructing the view of a landing.
  for(const f of [.29,.38,.46,.76]) {
    const p=track.pointAt(f*track.L),v=at(p,-(p.width/2+4),5);
    b.add('Wind pennant masts',CYL,ivory,v,[.15,10,.15]);
    const flag=mesh(group,'Sky pennant',new THREE.ConeGeometry(.8,4,3),teal,v.clone().add(V(0,3.5,0)));
    state.extras.push((dt,t)=>{flag.rotation.z=Math.PI/2+Math.sin(t*2+f*10)*.1;flag.rotation.y=yaw(p)+Math.sin(t*.8)*.25;});
  }
  atmosphere(group,state,rnd,0xfff4cd,100,-20,70,.9);
}

function ruins(group,track,rnd,state,b,floor,colliders,crown) {
  const stone=standard(crown?0xc79b70:0x9eaa91), dark=standard(crown?0x9b6c52:0x5f7968), pale=standard(crown?0xefc98f:0xcbd1ae), light=glow(crown?0xffd993:0xb3efcb), leaves=standard(0x50765d);
  ridge(b,rnd,floor,dark,crown?'Desert mesa horizon':'Vael forested escarpment',.7);
  const patch=new THREE.CircleGeometry(1,9).rotateX(-Math.PI/2);
  const soil=standard(crown?0xc79a69:0x6a815d);
  scatter(track,rnd,110,15,160,7,(v,p,i)=>{
    v.y=floor+.045;
    b.add('Natural ground variation',patch,soil,v,[8+rnd()*12,1,5+rnd()*10],i);
  });
  // Repeated columns create a legible, authored processional sector.
  for(let f=.27;f<.54;f+=.012) {
    const p=track.pointAt(f*track.L),v=at(p,-(p.width/2+9));
    if(!clearOfRoad(track,v,2.5)) continue;
    const h=8+(Math.floor(f*100)%3)*1.5;
    b.add('Processional column bases',BOX,dark,v.clone().add(V(0,.35,0)),[3.6,.7,3.6],yaw(p));
    b.add('Processional columns',CYL,pale,v.clone().add(V(0,h/2,0)),[1.1,h,1.1]);
    b.add('Processional capitals',BOX,stone,v.clone().add(V(0,h,0)),[3,.8,3],yaw(p));
  }
  tunnel(group,track,b,colliders,stone,light);
  scatter(track,rnd,130,16,110,6,(v,p,i)=>{
    const h=5+rnd()*15;v.y=floor;
    if(i%3===0) {
      b.add('Excavated foundation blocks',BOX,dark,v.clone().add(V(0,1.5,0)),[8,3,6],yaw(p));
      b.add('Broken carved pillars',CYL,stone,v.clone().add(V(0,h/2,0)),[1.8,h,1.8],i);
      b.add('Pillar capitals',BOX,pale,v.clone().add(V(0,h,0)),[4,.7,4],yaw(p));
    } else b.add('Weathered masonry',ROCK,stone,v.clone().add(V(0,1,0)),[3+rnd()*3,2+rnd()*2,3],i);
    if(!crown) {
      b.add('Laurel trunks',CYL,dark,v.clone().add(V(3,2,0)),[.35,4,.35]);
      b.add('Laurel crowns',ROCK,leaves,v.clone().add(V(3,3,0)),[4,4,4],i);
      b.add('Hanging temple vines',CONE,leaves,v.clone().add(V(0,h*.55,0)),[.7,h*.9,.8],i);
    }
  });
  for(const f of crown?[.22,.55,.92]:[.12,.48,.9]) arch(b,track.pointAt(f*track.L),stone,light,12,crown?'Royal processional arch':'Vael colonnade');
  if(crown) {
    // Terraced amphitheatre faces the bowl. Each piece is rejected if it
    // would intrude into any part of the circuit, including the infield.
    for(let row=0;row<6;row++) for(let i=0;i<46;i++) {
      const a=.05+i/45*Math.PI*1.25,r=194+row*8,v=V(30+Math.cos(a)*r,floor+2+row*2.4,Math.sin(a)*r);
      if(clearOfRoad(track,v,8)) b.add('Amphitheatre seating',BOX,stone,v,[12,2.2,7],-a+Math.PI/2);
    }
    // Crown-shaped royal dais sits in the broad outer infield, not the thread.
    const v=V(45,floor,10);
    for(let i=0;i<4;i++) b.add('Royal dais terraces',CYL,stone,v.clone().add(V(0,i*2,0)),[22-i*3,2,22-i*3]);
    mesh(group,'Sandstone crown monument',new THREE.TorusGeometry(9,1.2,6,24),pale,v.clone().add(V(0,17,0))).rotation.x=Math.PI/2;
    for(let i=0;i<8;i++) {
      const a=i/8*Math.PI*2;
      b.add('Crown spires',CONE,pale,v.clone().add(V(Math.cos(a)*9,19,Math.sin(a)*9)),[1.8,10,1.8]);
      b.add('Royal dais columns',CYL,dark,v.clone().add(V(Math.cos(a)*9,10,Math.sin(a)*9)),[1,14,1]);
      // Burgundy standards distinguish the royal bowl from Vael's green ruin.
      const q=v.clone().add(V(Math.cos(a)*30,7,Math.sin(a)*30));
      if(clearOfRoad(track,q,4)) {
        b.add('Royal standard poles',CYL,pale,q,[.16,14,.16]);
        b.add('Royal burgundy standards',BOX,standard(0x803e52),q.clone().add(V(1,4,0)),[2.2,4,.10],a);
      }
    }
    atmosphere(group,state,rnd,0xffdbad,100,floor,45,.35);
  } else {
    const v=V(20,floor,0);
    for(let i=0;i<4;i++) b.add('Sanctuary steps',BOX,stone,v.clone().add(V(0,i*.8,0)),[40-i*4,.8,32-i*4]);
    for(const x of [-13,13]) for(const z of [-9,9]) {
      b.add('Sanctuary fluted columns',CYL,pale,v.clone().add(V(x,10,z)),[1.6,16,1.6]);
      b.add('Sanctuary capitals',BOX,stone,v.clone().add(V(x,18,z)),[4,1.2,4]);
    }
    b.add('Sanctuary entablature',BOX,stone,v.clone().add(V(0,20,0)),[32,3,24]);
    const dial=mesh(group,'Vael celestial sundial',new THREE.TorusGeometry(8,.6,6,32),light,v.clone().add(V(0,31,0)));dial.rotation.y=.5;
    b.add('Sundial plinth',BOX,dark,v.clone().add(V(0,25,0)),[5,10,5]);
    state.extras.push((dt,t)=>{dial.rotation.z=t*.05;});
    atmosphere(group,state,rnd,0xe7ffd0,130,floor,45,.55);
  }
}

function tempest(group,track,rnd,state,b,floor) {
  const rock=standard(0x586e73), dark=standard(0x334a56), metal=standard(0xb0bfc0), amber=glow(0xffd69b);
  ridge(b,rnd,floor,rock,'Storm escarpments',1.25);
  for(let s=0;s<track.L;s+=18) {
    const p=track.pointAt(s),h=p.pos.y-floor;
    b.add('Ridge bedrock',ROCK,rock,at(p,0,-h*.7-1),[p.width*.9,h*.5,17],yaw(p));
  }
  scatter(track,rnd,95,25,160,12,(v,p,i)=>{
    const h=7+rnd()*22;v.y=floor+h*.25;
    b.add('Wind eroded outcrops',ROCK,dark,v,[8+rnd()*5,h,9],i);
  });
  // Turbines form a recognizable skyline; only the small rotor group animates.
  for(let i=0;i<7;i++) {
    const a=i/7*Math.PI*2,v=V(Math.cos(a)*360,floor,Math.sin(a)*310);
    b.add('Weather turbine masts',CYL,metal,v.clone().add(V(0,30,0)),[.9,60,.9]);
    const rotor=new THREE.Group();rotor.name='Wind turbine rotor';rotor.position.copy(v).add(V(0,59,0));rotor.rotation.y=-.3;group.add(rotor);
    mesh(rotor,'Turbine hub',new THREE.SphereGeometry(1.8,10,8),amber,V(0,0,0));
    for(let k=0;k<3;k++) {
      const arm=new THREE.Group();arm.rotation.z=k/3*Math.PI*2;rotor.add(arm);
      mesh(arm,'Turbine blade',new THREE.BoxGeometry(1.5,20,.5),metal,V(0,11,0));
    }
    state.extras.push((dt,t)=>{rotor.rotation.z=t*(.35+i*.02);});
  }
  // Windsocks and arrows show each crosswind's actual direction.
  for(const zone of track.def.zones) for(let f=zone.f0;f<zone.f1;f+=.045) {
    const p=track.pointAt(f*track.L),side=zone.v>0?1:-1;
    b.add('Windsock poles',CYL,metal,at(p,side*(p.width/2+4),4),[.14,8,.14]);
    const sock=mesh(group,'Crosswind windsock',new THREE.CylinderGeometry(.5,.22,3,8),amber,at(p,side*(p.width/2+4),7.6));
    state.extras.push((dt,t)=>{sock.rotation.set(0,yaw(p),side*(Math.PI/2+.12*Math.sin(t*3+f*8)));});
  }
  const v=V(25,floor,0);
  mesh(group,'Stormwatch station',new THREE.CylinderGeometry(9,12,30,10),dark,v.clone().add(V(0,15,0)));
  mesh(group,'Stormwatch lantern',new THREE.CylinderGeometry(9.2,9.2,3,10),amber,v.clone().add(V(0,27,0)));
  const dish=mesh(group,'Weather radar',new THREE.SphereGeometry(10,16,10,0,Math.PI*2,0,Math.PI*.5),metal,v.clone().add(V(0,37,0)));
  state.extras.push((dt,t)=>{dish.rotation.set(.5,t*.12,0);});
  // Slanted rain is local to this world, not a global flashing light.
  const vertices=new Float32Array(180*6),rain=new THREE.BufferGeometry();rain.setAttribute('position',new THREE.BufferAttribute(vertices,3));
  const origins=Array.from({length:180},()=>[(rnd()-.5)*650,rnd()*65,(rnd()-.5)*460]);
  const drops=new THREE.LineSegments(rain,new THREE.LineBasicMaterial({color:0xc2e0e5,transparent:true,opacity:.28,depthWrite:false}));drops.name='Ridge rainfall';group.add(drops);
  state.extras.push((dt,t)=>{origins.forEach(([x,y,z],i)=>{const h=((y-t*20)%65+65)%65;vertices.set([x+h*.18,floor+h,z,x+h*.18+.45,floor+h+2.5,z],i*6);});rain.attributes.position.needsUpdate=true;});
}

function glimmer(group,track,rnd,state,b,floor,colliders) {
  const rock=standard(0x45526b), dark=standard(0x27384b), crystal=new THREE.MeshStandardMaterial({color:0x82dad5,emissive:0x277c82,emissiveIntensity:.38,roughness:.3,metalness:.25,flatShading:true}), violet=standard(0x977db7), light=glow(0x8cf5e0);
  const shard=new THREE.CylinderGeometry(0,1,1,5);
  const stalactite=shard.clone().rotateZ(Math.PI);
  tunnel(group,track,b,colliders,rock,light,true);
  ridge(b,rnd,floor,dark,'Cavern enclosing walls',1.1);
  mesh(group,'Distant cavern ceiling',new THREE.SphereGeometry(690,24,12,0,Math.PI*2,0,Math.PI*.5),
    new THREE.MeshStandardMaterial({color:0x202d47,roughness:1,side:THREE.BackSide}),V(0,-30,0));
  // High irregular canopy leaves 25m+ driving/jump clearance. The vaulted
  // tunnel is denser; outside it the route opens into a vast geode chamber.
  for(let i=0;i<50;i++) {
    const a=i/50*Math.PI*2,r=220+rnd()*70;
    b.add('Cave roof shelves',ROCK,rock,V(Math.cos(a)*r,55+rnd()*15,Math.sin(a)*r),[65,17,65],a);
    b.add('Ceiling stalactites',stalactite,dark,V(Math.cos(a)*r,40,Math.sin(a)*r),[5,18,5],a);
  }
  scatter(track,rnd,180,13,145,8,(v,p,i)=>{
    v.y=floor;const h=4+rnd()*14;
    b.add('Crystal garden bases',ROCK,dark,v,[5,2,4],i);
    for(let k=0;k<3;k++) b.add(k===1?'Amethyst shards':'Turquoise shards',shard,k===1?violet:crystal,v.clone().add(V(k*2-2,h*(1-k*.18)/2,0)),[2-k*.35,h*(1-k*.18),2-k*.35],i+k);
  });
  const v=V(-15,floor,-5);
  mesh(group,'Heart geode plinth',ROCK,rock,v.clone().add(V(0,2,0))).scale.set(19,7,16);
  const heart=mesh(group,'Heart of Glimmer',new THREE.OctahedronGeometry(12,0),crystal,v.clone().add(V(0,23,0)));heart.scale.y=1.6;
  const orbit=mesh(group,'Geode resonance halo',new THREE.TorusGeometry(17,.18,5,48),light,v.clone().add(V(0,20,0)));orbit.rotation.x=1.2;
  state.extras.push((dt,t)=>{heart.rotation.y=t*.09;heart.position.y=v.y+23+Math.sin(t*.7)*.6;orbit.rotation.z=t*.12;});
  // Small reflective pools are offset and checked, never drawn over the road.
  const water=new THREE.MeshStandardMaterial({color:0x438da0,roughness:.18,metalness:.55});
  scatter(track,rnd,22,24,120,14,(v)=>{
    v.y=floor+.12;const pool=mesh(group,'Mineral pools',new THREE.CircleGeometry(12,24),water,v);pool.rotation.x=-Math.PI/2;
  });
  atmosphere(group,state,rnd,0xb9fcf2,180,floor,55,.6);
}

function space(group,track,rnd,state,b,colliders,voidWorld) {
  const hull=standard(voidWorld?0x535267:0x728695), dark=standard(voidWorld?0x303248:0x304b68), light=glow(voidWorld?0xd7afff:0x9bf3ed), gold=standard(0xb79c72);
  tunnel(group,track,b,colliders,hull,light);
  for(let s=0;s<track.L;s+=24) {
    const p=track.pointAt(s);
    b.add('Hull transverse ribs',BOX,dark,at(p,0,-2.6),[p.width+6,1.2,1.2],yaw(p));
    for(const side of [-1,1]) {
      b.add('External service pods',BOX,hull,at(p,side*(p.width/2+4),-2),[3,3,7],yaw(p));
      b.add('Pod status lights',BOX,light,at(p,side*(p.width/2+5.55),-1.5),[.12,.45,3],yaw(p));
    }
    b.add('Deck expansion seams',BOX,dark,at(p,0,.05),[p.width-3,.03,.15],yaw(p));
  }
  for(const f of [.08,.28,.69,.92]) arch(b,track.pointAt(f*track.L),hull,light,13,voidWorld?'Docking checkpoint':'Orbital navigation gate');
  // Ring central station and terminal cargo core have different silhouettes.
  if(!voidWorld) {
    const hub=V(0,-12,15);
    mesh(group,'Orbital habitat spindle',new THREE.CylinderGeometry(12,16,58,16),hull,hub);
    const ring=mesh(group,'Orbital habitation ring',new THREE.TorusGeometry(63,5,8,64),hull,hub);ring.rotation.x=Math.PI/2;
    const stripe=mesh(group,'Habitat illuminated equator',new THREE.TorusGeometry(63,1,6,64),light,hub.clone().add(V(0,4.8,0)));stripe.rotation.x=Math.PI/2;
    for(let i=0;i<8;i++) {
      const a=i/8*Math.PI*2;
      b.add('Station radial trusses',BOX,dark,hub.clone().add(V(Math.cos(a)*36,0,Math.sin(a)*36)),[56,2,2],-a);
    }
    const planetMat=new THREE.MeshStandardMaterial({color:0x4d88b7,roughness:1});
    const planet=mesh(group,'Blue planet',new THREE.SphereGeometry(145,40,24),planetMat,V(70,205,560));
    // A procedural latitude/cloud pattern; no downloaded planetary texture.
    planetMat.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec3 vPlanet;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n vPlanet=position;');
      shader.fragmentShader=`varying vec3 vPlanet;
        float planetHash(vec3 p) { return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
        float planetNoise(vec3 p) {
          vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(planetHash(i),planetHash(i+vec3(1,0,0)),f.x),
            mix(planetHash(i+vec3(0,1,0)),planetHash(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(planetHash(i+vec3(0,0,1)),planetHash(i+vec3(1,0,1)),f.x),
            mix(planetHash(i+vec3(0,1,1)),planetHash(i+vec3(1,1,1)),f.x),f.y),f.z);
        }
        float planetTerrain(vec3 p) {
          return planetNoise(p)*.55+planetNoise(p*2.1)*.28+planetNoise(p*4.3)*.12+planetNoise(p*8.2)*.05;
        }
      `+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        vec3 p=normalize(vPlanet);
        float land=planetTerrain(p*5.0+vec3(3,7,11));
        vec3 continent=mix(vec3(.14,.32,.23),vec3(.48,.46,.28),smoothstep(.58,.72,land));
        diffuseColor.rgb=mix(diffuseColor.rgb,continent,smoothstep(.50,.54,land));
        float cloud=planetTerrain(p*9.0+vec3(sin(p.y*7.0)*1.4,0,0));
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.85,.94,.98),smoothstep(.55,.69,cloud)*.85);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.86,.94,.98),smoothstep(.89,.97,abs(p.y)));
      `);
    };
    state.extras.push((dt,t)=>planet.rotation.y=t*.004);
    // Tall communications towers break up the outer-ring horizon.
    for(const f of [.16,.38,.72,.88]) {
      const p=track.pointAt(f*track.L),v=at(p,-(p.width/2+22),-2);
      if(!clearOfRoad(track,v,9)) continue;
      b.add('Comms platform',BOX,hull,v,[15,3,15],yaw(p));
      b.add('Comms mast',CYL,hull,v.clone().add(V(0,12,0)),[1.1,24,1.1]);
      const dish=mesh(group,'Orbital antenna dish',new THREE.SphereGeometry(7,12,8,0,Math.PI*2,0,Math.PI*.5),gold,v.clone().add(V(0,23,0)));
      dish.rotation.z=.65;dish.rotation.y=yaw(p);
      b.add('Comms mast beacon',CYL,light,v.clone().add(V(0,30,0)),[.5,1,.5]);
    }
    for(let i=0;i<10;i++) {
      const p=track.pointAt((.04+i*.095)*track.L),v=at(p,p.width/2+28,-5);
      if(!clearOfRoad(track,v,18)) continue;
      b.add('Solar array frames',BOX,gold,v,[22,.5,14],yaw(p));
      for(let k=-2;k<=2;k++) b.add('Photovoltaic panels',BOX,dark,v.clone().addScaledVector(p.right,k*4).add(V(0,.3,0)),[3.6,.15,13],yaw(p));
    }
  } else {
    const v=V(0,-3,-15);
    for(let i=0;i<3;i++) {
      b.add('Terminal core terraces',BOX,hull,v.clone().add(V(0,i*8,0)),[52-i*10,7,30-i*5]);
      b.add('Terminal observation windows',BOX,light,v.clone().add(V(0,i*8+2,0)),[52.2-i*10,1,30.2-i*5]);
    }
    const ring=mesh(group,'Void transit aperture',new THREE.TorusGeometry(21,2,8,48),dark,V(0,43,-15));
    mesh(group,'Transit aperture light',new THREE.TorusGeometry(19,.4,5,48),light,V(0,43,-14.9));
    state.extras.push((dt,t)=>ring.rotation.z=t*.045);
    scatter(track,rnd,90,24,130,8,(v,p,i)=>{
      v.y=-6+rnd()*3;
      b.add('Cargo berth platforms',BOX,dark,v.clone().add(V(0,-3,0)),[13,1.5,12],yaw(p));
      b.add('Freight containers',BOX,i%2?hull:gold,v,[10,5,6],yaw(p));
      for(const side of [-1,1]) b.add('Container reinforced edges',BOX,light,v.clone().addScaledVector(p.right,side*4.5),[.2,5.1,6.1],yaw(p));
    });
    for(let i=0;i<65;i++) {
      const a=i/65*Math.PI*2,r=390+rnd()*210;
      b.add('Distant asteroid belt',ROCK,dark,V(Math.cos(a)*r,-30+rnd()*180,Math.sin(a)*r),[8+rnd()*14,6+rnd()*12,8+rnd()*12],a);
    }
    const moon=mesh(group,'Terminal eclipsed moon',new THREE.SphereGeometry(90,24,16),standard(0x6c617b),V(-420,170,420));moon.rotation.z=.3;
  }
  // Silent service craft glide well above all driving/jump envelopes.
  const shuttle=new THREE.Group();shuttle.name='Station service shuttle';group.add(shuttle);
  mesh(shuttle,'Shuttle hull',new THREE.BoxGeometry(5,2,10),hull,V(0,0,0));
  mesh(shuttle,'Shuttle thrusters',new THREE.BoxGeometry(4,.7,.5),light,V(0,0,-5.1));
  mesh(shuttle,'Shuttle wings',new THREE.BoxGeometry(10,.4,4),dark,V(0,0,-1));
  state.extras.push((dt,t)=>{const a=t*.035;shuttle.position.set(Math.cos(a)*230,45+Math.sin(a*2)*7,Math.sin(a)*165);shuttle.rotation.y=-a;});
}

export function buildRefinedEnvironment(group,track,rnd,state,colliders) {
  const kit=REFINEMENT_KITS[track.id];if(!kit) return;
  const root=new THREE.Group();root.name=`${track.id} refined scenery`;group.add(root);
  const b=batcher(root),floor=Math.min(...track.samples.map(s=>s.pos.y))-kit.groundDepth;
  if(kit.ground===null) {
    deck(root,track.samples,kit.curbB);
    if(track.shortcut) deck(root,track.shortcut.samples,kit.curbB,false,0);
  } else {
    fascia(root,track.samples,floor,kit.curbB);
    if(track.shortcut) fascia(root,track.shortcut.samples,floor,kit.curbB,false,0);
  }
  furniture(root,track,b,kit,state);
  switch(track.id) {
    case 'forge_line': forge(root,track,rnd,state,b,floor,colliders);break;
    case 'skyreach': skyreach(root,track,rnd,state,b);break;
    case 'ruins_of_vael': ruins(root,track,rnd,state,b,floor,colliders,false);break;
    case 'sandstone_crown': ruins(root,track,rnd,state,b,floor,colliders,true);break;
    case 'tempest_ridge': tempest(root,track,rnd,state,b,floor);break;
    case 'glimmer_deep': glimmer(root,track,rnd,state,b,floor,colliders);break;
    case 'orbital_ring': space(root,track,rnd,state,b,colliders,false);break;
    case 'void_terminal': space(root,track,rnd,state,b,colliders,true);break;
  }
  b.flush();
  // Initialize animated instance matrices before first frame/culling.
  for(const update of state.extras) update(0,0);
}
