// Bespoke scenery for Granite Pass, Magma Coil and Abyss Dock only.
// All scattering is deterministic, rejects BOTH road and shortcut envelopes,
// and batches repeated shapes. No textures/assets/network requests required.
import * as THREE from '../lib/three.module.js';

export const EXPEDITION_KITS = {
  granite_pass: {
    refinedRoad: true,
    sky: ['#3976b0', '#83b6d5', '#dce7e5', '#fff0cd'], fog: [0xcbdce1, 210, 760],
    hemi: [0xe4f4ff, 0x46554e, 1.15], sun: [0xffe0ac, 1.65], sunPos: [-180, 240, -120],
    ground: 0x566963, groundDepth: 3, road: [0.32, 0.36, 0.38], curbA: 0xe9e6d8, curbB: 0xb54d35,
    shoulder: [0.39, 0.43, 0.42], edge: [0.95, 0.90, 0.73], road2: true,
    sunDisc: { color: 0xffe5b4, r: 25, pos: [-520, 320, -480] },
    banner: { bg: '#203f4b', stripe: '#cc7847', text: '#fff1d4' },
  },
  magma_coil: {
    refinedRoad: true,
    sky: ['#100f23', '#302135', '#773834', '#de7841'], fog: [0x60333c, 180, 670],
    hemi: [0xc4b5cf, 0x50231d, 1.15], sun: [0xffc18a, 1.4], sunPos: [-180, 130, 80],
    ground: 0x211d29, groundDepth: 5, road: [0.29, 0.29, 0.33], curbA: 0xffb04e, curbB: 0x312d38,
    shoulder: [0.19, 0.17, 0.23], edge: [1, 0.8, 0.47], road2: true,
    banner: { bg: '#251d30', stripe: '#e96235', text: '#ffe1a4' },
  },
  abyss_dock: {
    refinedRoad: true,
    sky: ['#020f28', '#05324d', '#126176', '#287d8b'], fog: [0x12596a, 130, 520],
    hemi: [0xb9f4ee, 0x12374b, 1.2], sun: [0x9adbea, 1.3], sunPos: [60, 240, -80],
    ground: 0x254e59, groundDepth: 9, road: [0.24, 0.35, 0.41], curbA: 0x9ff4dd, curbB: 0x245969,
    shoulder: [0.16, 0.26, 0.32], edge: [0.65, 0.98, 0.92], road2: true, wet: true,
    banner: { bg: '#103344', stripe: '#32aab1', text: '#d8fff2' },
  },
};
const standard = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
const glow = (color) => new THREE.MeshBasicMaterial({ color });
const yaw = p => Math.atan2(p.dir.x, p.dir.z);
function at(p, x = 0, y = 0, z = 0) {
  return p.pos.clone().addScaledVector(p.right, x).addScaledVector(p.dir, z).add(new THREE.Vector3(0,y,0));
}
function mesh(group, name, geo, mat, pos) {
  const m = new THREE.Mesh(geo, mat); m.name = name; m.position.copy(pos); group.add(m); return m;
}
// One draw call per primitive/material, not one per prop.
function batcher(group) {
  const batches = new Map();
  const d = new THREE.Object3D();
  return {
    add(key, geo, mat, pos, scale, rotation = 0, color = null) {
      if (!batches.has(key)) batches.set(key, { geo, mat, instances: [] });
      d.position.copy(pos); d.scale.set(...scale); d.rotation.set(0, rotation, 0); d.updateMatrix();
      batches.get(key).instances.push({ matrix: d.matrix.clone(), color });
    },
    flush() {
      for (const [name, b] of batches) {
        const tinted = b.instances.some(v => v.color !== null);
        // Instance colours replace the base tint, not multiply it twice.
        const mat = tinted ? b.mat.clone() : b.mat;
        if (tinted) mat.color.setHex(0xffffff);
        const m = new THREE.InstancedMesh(b.geo, mat, b.instances.length); m.name = name;
        b.instances.forEach((v, i) => {
          m.setMatrixAt(i, v.matrix);
          if (tinted) m.setColorAt(i, v.color === null ? b.mat.color : new THREE.Color(v.color));
        });
        m.instanceMatrix.needsUpdate = true;
        group.add(m);
      }
    },
  };
}
function clearOfRoad(track, pos, radius) {
  const safe = samples => samples.every(p => Math.hypot(p.pos.x-pos.x, p.pos.z-pos.z) > p.width / 2 + radius + 4);
  return safe(track.samples) && (!track.shortcut || safe(track.shortcut.samples));
}
// Vertical fascia grounds elevated ribbons; lower terrain is never at road level.
function fascia(group, samples, floor, color, closed = true, apron = 2.6) {
  const verts = [], indices = [];
  for (const side of [-1, 1]) {
    const base = verts.length / 3;
    for (let i=0; i <= (closed ? samples.length : samples.length-1); i++) {
      const p = samples[i % samples.length], v = at(p, side * (p.width/2 + apron));
      verts.push(v.x, v.y - 0.04, v.z, v.x, floor, v.z);
      if (i) { const n = base + i*2; indices.push(n-2,n-1,n,n-1,n+1,n); }
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(verts,3));
  geo.setIndex(indices); geo.computeVertexNormals();
  const mat = standard(color); mat.side = THREE.DoubleSide;
  mesh(group, 'Road retaining walls', geo, mat, new THREE.Vector3());
}
function sign(group, p, side, text, accent) {
  const c = document.createElement('canvas'); c.width=256; c.height=128;
  const g = c.getContext('2d');
  g.fillStyle='#142932'; g.fillRect(0,0,256,128);
  g.fillStyle=accent; g.fillRect(0,0,256,7); g.fillRect(0,121,256,7);
  g.font='bold 74px sans-serif'; g.textAlign='center'; g.textBaseline='middle'; g.fillText(text,128,67);
  const m = mesh(group, 'Route guidance', new THREE.PlaneGeometry(4.8,2.4),
    new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),side:THREE.DoubleSide}), at(p, side*(p.width/2+4),3.5));
  m.rotation.y=yaw(p)+Math.PI;
  mesh(group,'Sign post',new THREE.BoxGeometry(.16,3,.16),standard(0x3f535c),at(p,side*(p.width/2+4),1.5));
}
function atmosphere(group, state, rnd, color, count, base, height, speed) {
  const positions = new Float32Array(count*3), origins=[];
  for(let i=0;i<count;i++) {
    const x=(rnd()-.5)*650, z=(rnd()-.5)*500, y=rnd()*height;
    origins.push([x,y,z]); positions.set([x,base+y,z],i*3);
  }
  const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const mat=new THREE.PointsMaterial({color,size:0.45,transparent:true,opacity:.55,depthWrite:false});
  mat.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\n diffuseColor.a *= 1.0 - smoothstep(0.18, 0.5, length(gl_PointCoord - 0.5));');
  };
  const points=new THREE.Points(geo,mat); points.name='Ambient drifting particles'; group.add(points);
  state.extras.push((dt,time)=>{
    for(let i=0;i<count;i++) {
      positions[i*3]=origins[i][0]+Math.sin(time*.18+i)*2;
      positions[i*3+1]=base+((origins[i][1]+time*speed)%height+height)%height;
    }
    geo.attributes.position.needsUpdate=true;
  });
}

function roadFurniture(group, track, kit, b) {
  const box = new THREE.BoxGeometry(1,1,1), metal=standard(0x596b73), light=glow(kit.curbA);
  const isMountain=track.id==='granite_pass';
  // Low delineators, not fake collision barriers. Leave shortcut access open.
  for(let s=10;s<track.L;s+=12) {
    const p=track.pointAt(s), f=s/track.L;
    if(track.def.shortcut && f>track.def.shortcut.entry-.02 && f<track.def.shortcut.exit+.02) continue;
    for(const side of [-1,1]) {
      b.add('Edge delineators',box,metal,at(p,side*(p.width/2+1.8),.65),[.22,1.3,.24],yaw(p));
      b.add('Edge reflectors',box,light,at(p,side*(p.width/2+1.8),1.13),[.32,.24,.32],yaw(p));
      if(!isMountain) b.add('Deck edge lights',box,light,at(p,side*(p.width/2+.8),.12),[.22,.15,3],yaw(p));
    }
  }
  const sections=track.id==='granite_pass'?[.25,.42,.65,.88]:track.id==='magma_coil'?[.16,.38,.68,.85]:[.14,.30,.50,.80];
  sections.forEach((f,i)=>sign(group,track.pointAt(track.L*f),-1,`0${i+1}`,isMountain?'#ffd997':track.id==='magma_coil'?'#ffb35f':'#86ffe6'));
  // Pre-turn chevrons face the approach, placed on the outside of each bend.
  for(let f=.08;f<.98;f+=.045) {
    const p=track.pointAt(f*track.L), ahead=track.pointAt(f*track.L+28);
    const cross=p.dir.x*ahead.dir.z-p.dir.z*ahead.dir.x;
    if(Math.abs(cross)>.28) sign(group,p,cross>0?1:-1,cross>0?'‹‹':'››','#ffe9a0');
  }
}

function granite(group, track, rnd, state, b, floor) {
  const rock=standard(0x71838b), snow=standard(0xe3edf0), fir=standard(0x28574d), trunk=standard(0x69594a);
  const cone=new THREE.ConeGeometry(1,1,7), box=new THREE.BoxGeometry(1,1,1);
  // Irregular ridgelines with a broken snowline, rather than perfect cones.
  const peakGeo=new THREE.ConeGeometry(1,1,9,4).toNonIndexed();
  const positions=peakGeo.attributes.position, colors=[];
  for(let i=0;i<positions.count;i++) {
    const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
    const rough=1+Math.sin(x*11+z*7+y*13)*.17;
    positions.setXYZ(i,x*rough+y*.18,y,z*rough);
    const c=new THREE.Color(y>.12+Math.sin(x*9+z*11)*.06?0xe0edf1:0x7a8b91);
    colors.push(c.r,c.g,c.b);
  }
  peakGeo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));peakGeo.computeVertexNormals();
  const peakMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,flatShading:true});
  for(let i=0;i<22;i++) {
    const angle=i/22*Math.PI*2, radius=430+rnd()*130, h=75+rnd()*125, r=65+rnd()*55;
    const p=new THREE.Vector3(Math.cos(angle)*radius,floor+h/2,Math.sin(angle)*radius);
    b.add('Alpine ridge',peakGeo,peakMat,p,[r,h,r*.8],angle);
  }
  const boulder=new THREE.IcosahedronGeometry(1,1);
  for(let i=0;i<110;i++) {
    const p=track.pointAt(rnd()*track.L), r=4+rnd()*13;
    const v=at(p,(rnd()<.5?-1:1)*(p.width/2+20+rnd()*85));
    if(!clearOfRoad(track,v,r*1.3)) continue;
    v.y=floor+r*.2;
    b.add('Granite foothills',boulder,rock,v,[r*1.2,r*.7,r],rnd()*6, i%2?0x7a8b91:0x8f9c9b);
  }
  for(let i=0;i<220;i++) {
    const p=track.pointAt(rnd()*track.L), side=rnd()<.5?-1:1;
    const v=at(p,side*(p.width/2+12+rnd()*75));
    const h=5+rnd()*10;
    if(!clearOfRoad(track,v,3.5)) continue;
    // Local rocky foothills hide the empty space below the elevated ascent.
    v.y=floor+h/2;
    b.add('Alpine fir trunks',box,trunk,v,[.55,h,.55]);
    for(let k=0;k<3;k++) b.add('Alpine fir canopy',cone,fir,v.clone().setY(floor+h*(.5+k*.21)),[h*(.31-k*.06),h*.65,h*(.31-k*.06)],0,k%2?0x356b5b:0x28574d);
  }
  for(let s=20;s<track.L;s+=26) {
    const p=track.pointAt(s), h=p.pos.y-floor;
    for(const side of [-1,1]) {
      b.add('Granite buttresses',box,rock,at(p,side*(p.width/2+2.9),-h/2),[2.4,h,4],yaw(p));
      b.add('Snow shoulder stones',box,snow,at(p,side*(p.width/2+3.1),.13),[1.2,.26,5],yaw(p));
    }
  }
  // Cantilevered lookout and copper-roofed alpine station at the summit.
  const p=track.pointAt(track.L*.65), station=at(p,-(p.width/2+18),0);
  const stationGroup=new THREE.Group(); stationGroup.name='Summit lookout'; stationGroup.position.copy(station); stationGroup.rotation.y=yaw(p); group.add(stationGroup);
  const local=(x,y,z)=>new THREE.Vector3(x,y,z);
  mesh(stationGroup,'Lookout terrace',new THREE.BoxGeometry(18,1,13),rock,local(0,-.8,0));
  mesh(stationGroup,'Alpine station',new THREE.BoxGeometry(10,6,7),standard(0xd6ceae),local(0,2.7,1));
  const roof=mesh(stationGroup,'Copper roof',new THREE.ConeGeometry(8,3,4),standard(0x3c6b68),local(0,7,1)); roof.rotation.y=Math.PI/4;
  for(const x of [-3,0,3]) mesh(stationGroup,'Warm station windows',new THREE.BoxGeometry(1.8,2,.08),glow(0xffcf83),local(x,3,-2.55));
  for(const x of [-7,7]) mesh(stationGroup,'Lookout piers',new THREE.BoxGeometry(2,p.pos.y-floor,9),rock,local(x,-(p.pos.y-floor)/2,0));
  // An animated windsock makes the high exposed summit legible.
  const pole=at(p,p.width/2+7,5);
  mesh(group,'Summit windsock mast',new THREE.CylinderGeometry(.1,.16,10,6),trunk,pole);
  const sock=mesh(group,'Summit windsock',new THREE.CylinderGeometry(.55,.22,3.4,8),standard(0xdd754a),pole.clone().add(new THREE.Vector3(1.5,4.5,0)));
  sock.rotation.z=-Math.PI/2;
  state.extras.push((dt,time)=>{sock.rotation.x=Math.sin(time*1.8)*.12;sock.rotation.z=-Math.PI/2+Math.sin(time*2.4)*.08;});
  for(const {mesh: obstacleMesh, obstacle} of state.obstacleMeshes) {
    if(obstacle.type !== 'pendulum') continue;
    const spec=track.def.obstacles.find(o=>o.type==='pendulum');
    const p=track.pointAt(spec.s*track.L), anchor=at(p,spec.lat,10);
    obstacleMesh.geometry.dispose(); obstacleMesh.material.dispose();
    obstacleMesh.geometry=new THREE.IcosahedronGeometry(1.7,1);obstacleMesh.material=rock;
    for(const side of [-1,1]) b.add('Quarry hoist supports',box,trunk,at(p,side*(p.width/2+4),5),[.8,10,.8],yaw(p));
    b.add('Quarry hoist beam',box,trunk,at(p,0,10),[p.width+9,.8,.8],yaw(p));
    const cable=mesh(group,'Quarry hoist cable',new THREE.CylinderGeometry(.06,.06,1,5),standard(0x394954),anchor);
    const axis=new THREE.Vector3(0,1,0), delta=new THREE.Vector3();
    state.extras.push(()=>{
      delta.copy(anchor).sub(obstacle.pos);cable.position.copy(anchor).add(obstacle.pos).multiplyScalar(.5);
      cable.scale.y=delta.length();cable.quaternion.setFromUnitVectors(axis,delta.normalize());
    });
    sign(group,track.pointAt(spec.s*track.L-26),-1,'!','#ffe1a4');
  }
  atmosphere(group,state,rnd,0xf5f7ea,110,15,70,-1.5);
}

function magma(group, track, rnd, state, b, floor) {
  const basalt=standard(0x39333f), metal=standard(0x75616b), hot=glow(0xff8737);
  const column=new THREE.CylinderGeometry(.85,1,1,6), box=new THREE.BoxGeometry(1,1,1);
  for(let i=0;i<250;i++) {
    const p=track.pointAt(rnd()*track.L), side=rnd()<.5?-1:1, r=2+rnd()*4;
    const v=at(p,side*(p.width/2+10+rnd()*75));
    if(!clearOfRoad(track,v,r)) continue;
    const h=4+rnd()*20; v.y=floor+h/2;
    b.add('Hexagonal basalt field',column,basalt,v,[r,h,r],rnd(),i%3?0x39333f:0x504452);
    if(i%4===0) b.add('Molten basalt caps',column,hot,v.clone().setY(floor+h+.1),[r*.77,.18,r*.77]);
  }
  const ridgeGeo=new THREE.IcosahedronGeometry(1,1);
  for(let i=0;i<24;i++) {
    const a=i/24*Math.PI*2,r=320+rnd()*80,h=30+rnd()*60;
    b.add('Caldera enclosing ridge',ridgeGeo,basalt,new THREE.Vector3(Math.cos(a)*r,floor+h*.35,Math.sin(a)*r),[50,h,48],a,0x685260);
  }
  // An inner lava basin stays outside the inner-coil driving envelope.
  const basin=mesh(group,'Inner lava basin',new THREE.CircleGeometry(43,32),hot,new THREE.Vector3(22,floor+.1,61));basin.rotation.x=-Math.PI/2;
  for(let i=0;i<30;i++) {
    const a=i/30*Math.PI*2;
    b.add('Lava basin crust',ridgeGeo,basalt,new THREE.Vector3(22+Math.cos(a)*44,floor+.5,61+Math.sin(a)*44),[5,2,4],a,0x6f5260);
  }
  // Lava channels run beside (never on) the road; matching embankments make
  // their height intentional rather than floating disks above the terrain.
  const lavaMat=new THREE.MeshBasicMaterial({color:0xff6425});
  const lavaVertices=[], lavaIndices=[];
  for(let s=0;s<track.L;s+=8) {
    const p=track.pointAt(s);
    const a=at(p,p.width/2+5), c=at(p,p.width/2+11);
    if(!clearOfRoad(track,c,2)) continue;
    const q=track.pointAt(s+8), d=at(q,q.width/2+5), e=at(q,q.width/2+11), n=lavaVertices.length/3;
    for(const v of [a,c,d,e]) lavaVertices.push(v.x,floor+.15,v.z);
    lavaIndices.push(n,n+2,n+1,n+1,n+2,n+3);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(lavaVertices,3));geo.setIndex(lavaIndices);
  lavaMat.side=THREE.DoubleSide;mesh(group,'Lava tributaries',geo,lavaMat,new THREE.Vector3());
  state.extras.push((dt,time)=>lavaMat.color.setRGB(1,.23+Math.sin(time*.7)*.04,.035));
  // Signature caldera visible above the whole lap, safely beyond the circuit.
  const center=new THREE.Vector3(290,floor+41,200);
  mesh(group,'Caldera massif',new THREE.CylinderGeometry(28,92,82,14),basalt,center);
  const crater=mesh(group,'Incandescent crater',new THREE.TorusGeometry(28,3,6,32),hot,center.clone().add(new THREE.Vector3(0,41,0))); crater.rotation.x=Math.PI/2;
  const pool=mesh(group,'Crater lake',new THREE.CircleGeometry(27,32),hot,center.clone().add(new THREE.Vector3(0,40,0)));pool.rotation.x=-Math.PI/2;
  const smokeMat=new THREE.MeshBasicMaterial({color:0x44313c,transparent:true,opacity:.22,depthWrite:false});
  const smoke=[];
  for(let i=0;i<9;i++) smoke.push(mesh(group,'Caldera plume',new THREE.IcosahedronGeometry(1,1),smokeMat,center));
  state.extras.push((dt,time)=>smoke.forEach((m,i)=>{const t=(time*2+i*11)%100;m.position.set(center.x+t*.22, floor+87+t,center.z);m.scale.setScalar(8+t*.18);}));
  // Industrial heat-exchanger gantries frame recovery straights, with no
  // road-level crossbeam or center-lane prop that could obscure a hazard.
  for(const f of [.12,.52,.94]) {
    const p=track.pointAt(f*track.L);
    for(const side of [-1,1]) {
      b.add('Heat exchanger columns',box,metal,at(p,side*(p.width/2+5),5),[2,10,3],yaw(p));
      b.add('Heat exchanger warning strips',box,hot,at(p,side*(p.width/2+5),6),[2.1,.35,3.1],yaw(p));
    }
    b.add('Heat exchanger crossbeams',box,basalt,at(p,0,10),[p.width+12,1.2,3],yaw(p));
  }
  for(const [index, o] of track.obstacles.entries()) {
    if(o.type!=='flamejet') continue;
    const spec=track.def.obstacles[index], p=track.pointAt(spec.s*track.L), lat=spec.lat||0;
    const ring=mesh(group,'Vent warning halo',new THREE.RingGeometry(o.radius+.25,o.radius+.55,24),glow(0xffca58),at(p,lat,.07));ring.rotation.x=-Math.PI/2;
    state.extras.push((dt,time)=>{ring.material.color.setHex(o.active?0xff5733:0xffd589);ring.material.color.multiplyScalar(.8+.2*Math.sin(time*4));});
    sign(group,track.pointAt(spec.s*track.L-24),-1,'!','#ffb35f');
  }
  atmosphere(group,state,rnd,0xffba69,160,floor,65,2.4);
}

function pressureTunnel(group, track, state, colliders) {
  const [start,end]=track.tunnelRange, rib=standard(0x63838d), light=glow(0x8bffdf);
  const verts=[], indices=[];
  for(let s=start,i=0;s<=end+3;s+=4,i++) {
    const p=track.pointAt(Math.min(s,end)), hw=p.width/2+3;
    for(let j=0;j<=16;j++) {
      const a=j/16*Math.PI, v=at(p,Math.cos(a)*hw,.3+Math.sin(a)*9);
      verts.push(v.x,v.y,v.z);
      if(i&&j) {const n=i*17+j;indices.push(n-18,n-17,n,n-18,n,n-1);}
    }
    if(i%2===0) {
      const arch=mesh(group,'Pressure tunnel ribs',new THREE.TorusGeometry(1,.025,5,24,Math.PI),rib,at(p,0,.3));
      arch.scale.set(hw,9,hw);arch.rotation.y=yaw(p);
      for(const side of [-1,1]) {
        const foot=mesh(group,'Pressure rib feet',new THREE.BoxGeometry(1,3,1),rib,at(p,side*hw,1));
        colliders.push(new THREE.Box3().setFromObject(foot));
        mesh(group,'Tunnel running lights',new THREE.SphereGeometry(.3,6,4),light,at(p,side*(hw-.5),2));
      }
    }
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setIndex(indices);geo.computeVertexNormals();
  mesh(group,'Observation tunnel glass',geo,new THREE.MeshStandardMaterial({color:0x81dddf,transparent:true,opacity:.09,side:THREE.DoubleSide,roughness:.2,depthWrite:false}),new THREE.Vector3());
}

function abyss(group, track, rnd, state, b, floor, colliders) {
  const metal=standard(0x406778), pale=standard(0x91b8bd), light=glow(0x81ffe2);
  const box=new THREE.BoxGeometry(1,1,1), cone=new THREE.ConeGeometry(1,1,6), sphere=new THREE.IcosahedronGeometry(1,0);
  const coral=standard(0xffffff), kelp=standard(0x398e80);
  const reef=standard(0x4f7d87);
  for(let i=0;i<100;i++) {
    const p=track.pointAt(rnd()*track.L), r=4+rnd()*10;
    const v=at(p,(rnd()<.5?-1:1)*(p.width/2+22+rnd()*110));
    if(!clearOfRoad(track,v,r*1.4)) continue;
    v.y=floor+r*.2;
    b.add('Seabed reef shelves',sphere,reef,v,[r*1.4,r*.65,r],rnd()*6);
  }
  for(let i=0;i<240;i++) {
    const p=track.pointAt(rnd()*track.L), side=rnd()<.5?-1:1, v=at(p,side*(p.width/2+10+rnd()*70));
    if(!clearOfRoad(track,v,4)) continue;
    v.y=floor;
    if(i%3===0) {
      for(let k=0;k<3;k++) b.add('Branching coral',sphere,coral,v.clone().add(new THREE.Vector3(k-1,1+k*.6,0)),[1,1.4,1],rnd(),[0xd5779d,0xe5ad7b,0x57c6b3][i%3+k]);
    } else {
      const h=3+rnd()*8;
      b.add('Kelp gardens',cone,kelp,v.clone().setY(floor+h/2),[.6,h,1.6],rnd()*Math.PI);
    }
  }
  for(let s=0;s<track.L;s+=28) {
    const p=track.pointAt(s), h=p.pos.y-floor;
    for(const side of [-1,1]) b.add('Dock foundation piles',box,metal,at(p,side*(p.width/2+1),-h/2),[1.4,h,2],yaw(p));
    b.add('Deck expansion joints',box,metal,at(p,0,.045),[p.width-3,.025,.16],yaw(p));
  }
  pressureTunnel(group,track,state,colliders);
  // Dock cranes and bathyspheres give the facility a purpose and a scale.
  for(const f of [.06,.79]) {
    const p=track.pointAt(f*track.L), side=-1;
    b.add('Dock crane towers',box,metal,at(p,side*(p.width/2+12),10),[2,20,2],yaw(p));
    b.add('Dock crane booms',box,pale,at(p,side*(p.width/2+18),20),[15,1,1.4],yaw(p));
    b.add('Bathysphere cables',box,metal,at(p,side*(p.width/2+24),13),[.1,13,.1],yaw(p));
    const v=at(p,side*(p.width/2+24),5);
    mesh(group,'Research bathysphere',new THREE.SphereGeometry(3.5,16,10),standard(0xd7ad62),v);
    const port=mesh(group,'Bathysphere viewport',new THREE.SphereGeometry(2,12,8),light,v.clone().addScaledVector(p.right,2));port.scale.set(1,1,.7);
  }
  // Observation habitat, with a lit equator and landing pylons.
  const pos=new THREE.Vector3(30,floor+9,12);
  mesh(group,'Abyss observatory',new THREE.SphereGeometry(16,24,12),metal,pos).scale.y=.6;
  const ring=mesh(group,'Observatory viewing band',new THREE.TorusGeometry(15.5,.65,6,40),light,pos);ring.rotation.x=Math.PI/2;
  for(const x of [-10,10]) for(const z of [-8,8]) b.add('Observatory pylons',box,pale,new THREE.Vector3(pos.x+x,floor+3,pos.z+z),[1.5,6,1.5]);
  // Distinct gate language for buoyancy (rings) and forward current (chevrons).
  for(const zone of track.def.zones) {
    for(let f=zone.f0;f<=zone.f1;f+=.025) {
      const p=track.pointAt(f*track.L);
      if(zone.type==='lowgrav') {
        const arch=mesh(group,'Buoyancy chamber halo',new THREE.TorusGeometry(1,.018,5,24,Math.PI),light,at(p,0,.1));
        arch.scale.set(p.width/2+2,10,p.width/2+2);arch.rotation.y=yaw(p);
      } else {
        for(const side of [-1,1]) for(const angle of [-.6,.6]) b.add('Current flow arrows',box,light,at(p,side*(p.width/2-2)+Math.sign(angle)*.42,.09),[.18,.04,1.5],yaw(p)-angle);
      }
    }
  }
  // Fish use one animated instanced draw call. Swim above the road envelope.
  const fish=new THREE.InstancedMesh(new THREE.ConeGeometry(.35,1.4,4),glow(0x9ed8d7),56);fish.name='School of silver fish';group.add(fish);
  const d=new THREE.Object3D();
  state.extras.push((dt,time)=>{
    for(let i=0;i<56;i++) {const a=time*.07+i*.11;d.position.set(Math.cos(a)*95+i%7*2,20+Math.sin(a*2)*3+i%4,Math.sin(a)*70);d.rotation.set(Math.PI/2,0,-a);d.updateMatrix();fish.setMatrixAt(i,d.matrix);}
    fish.instanceMatrix.needsUpdate=true;
  });
  const rayMat=new THREE.MeshBasicMaterial({color:0x8de2e2,transparent:true,opacity:.035,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending});
  for(let i=0;i<6;i++) {
    const ray=mesh(group,'Filtered light shafts',new THREE.CylinderGeometry(2,14,120,8,1,true),rayMat,new THREE.Vector3(-220+i*85,48,-60+(i%2)*160));ray.rotation.z=.22;
  }
  atmosphere(group,state,rnd,0xbbfff0,180,floor,65,1.7);
}

export function buildExpeditionEnvironment(group, track, rnd, state, colliders) {
  const kit=EXPEDITION_KITS[track.id];
  if(!kit) return;
  const root=new THREE.Group();root.name=`${track.id} bespoke scenery`;group.add(root);
  const b=batcher(root), floor=Math.min(...track.samples.map(s=>s.pos.y))-kit.groundDepth;
  fascia(root,track.samples,floor,track.id==='granite_pass'?0x65777c:0x354651);
  if(track.shortcut) fascia(root,track.shortcut.samples,floor,0x354651,false,0);
  roadFurniture(root,track,kit,b);
  if(track.id==='granite_pass') granite(root,track,rnd,state,b,floor);
  if(track.id==='magma_coil') magma(root,track,rnd,state,b,floor);
  if(track.id==='abyss_dock') abyss(root,track,rnd,state,b,floor,colliders);
  b.flush();
}
