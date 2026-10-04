// Widok 3D tej samej symulacji (Three.js). Logika świata zostaje 2D — tu tylko rysujemy krajobraz,
// a stworki i rośliny stawiamy na wysokości terenu. Ustawienia (kolory, podświetlenia, zaznaczenie)
// czytamy z renderera 2D, żeby oba widoki zawsze pokazywały to samo.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { BIOMES, CELL } from './terrain.js';
import { WORLD_W, WORLD_H } from './sim.js';
import { clamp, lerp, makeNoise, mulberry32 } from './util.js';

const HX = WORLD_W / 2, HZ = WORLD_H / 2;
const LAND_K = 300, SEA_K = 220;
const MAX_PLANTS = 3000, MAX_MEAT = 800, MAX_CREATURES = 420;

const GLOW_VS = `
attribute float size;
attribute vec3 color;
varying vec3 vColor;
uniform float uScale;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FS = `
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a = a * a * 0.55;
  gl_FragColor = vec4(vColor * a, a);
}`;

export class Renderer3D {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.s = settings; // renderer 2D: colorMode, mapMode, highlightSpecies, selected, hover, brush, tex
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05070a');
    this.scene.fog = new THREE.FogExp2('#05070a', 0.00022);
    this.camera = new THREE.PerspectiveCamera(50, 1, 2, 9000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = 1.42;
    this.controls.minDistance = 25;
    this.controls.maxDistance = 3800;
    this.controls.screenSpacePanning = false;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

    // światło
    this.hemi = new THREE.HemisphereLight('#b8ccff', '#3a2a18', 2.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff1d6', 2.4);
    this.sun.position.set(-900, 1350, 600);
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.55));

    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.dummy = new THREE.Object3D();
    this.col = new THREE.Color();
    this.particles3d = [];
    this.buildStatic();
    this.resize();
    this.fit();
  }

  // ---------- Obiekty stałe ----------
  buildStatic() {
    // teren
    this.terrainTex = new THREE.CanvasTexture(this.s.tex);
    this.terrainTex.colorSpace = THREE.SRGBColorSpace;
    this.terrainTex.anisotropy = 4;
    this.terrainMat = new THREE.MeshLambertMaterial({ map: this.terrainTex });
    this.terrainMesh = null;

    // woda
    const wg = new THREE.PlaneGeometry(WORLD_W, WORLD_H);
    wg.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.MeshPhongMaterial({ color: '#1f5f8a', transparent: true, opacity: 0.5, shininess: 90, specular: '#7fb8e0', depthWrite: false });
    this.water = new THREE.Mesh(wg, this.waterMat);
    this.water.position.y = 0;
    this.water.renderOrder = 2;
    this.scene.add(this.water);

    // ramka świata
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(WORLD_W, 1, WORLD_H)),
      new THREE.LineBasicMaterial({ color: '#4fd1c5', transparent: true, opacity: 0.25 }));
    frame.position.y = 0.5;
    this.scene.add(frame);

    // rośliny: małe stożki
    const pg = new THREE.ConeGeometry(1, 2.6, 6);
    pg.translate(0, 1.3, 0);
    this.plantMesh = new THREE.InstancedMesh(pg, new THREE.MeshLambertMaterial({ color: '#ffffff' }), MAX_PLANTS);
    this.plantMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.plantMesh.setColorAt(0, this.col);
    this.scene.add(this.plantMesh);

    // mięso
    this.meatMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#c84646' }), MAX_MEAT);
    this.meatMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.meatMesh);

    // stworki: kule
    this.bodyMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.05, emissive: '#000000' });
    this.bodyMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 3), this.bodyMat, MAX_CREATURES);
    this.bodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bodyMesh.setColorAt(0, this.col);
    this.scene.add(this.bodyMesh);
    // oczy
    this.eyeMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }), MAX_CREATURES);
    this.eyeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.eyeMesh);
    // obręcz diety (wszystkożercy / mięsożercy)
    const tg = new THREE.TorusGeometry(1, 0.12, 6, 28);
    tg.rotateX(Math.PI / 2);
    this.ringMesh = new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({ color: '#ffffff' }), MAX_CREATURES);
    this.ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ringMesh.setColorAt(0, this.col);
    this.scene.add(this.ringMesh);

    // poświata (punkty z addytywnym mieszaniem)
    const gg = new THREE.BufferGeometry();
    this.glowPos = new Float32Array(MAX_CREATURES * 3);
    this.glowCol = new Float32Array(MAX_CREATURES * 3);
    this.glowSize = new Float32Array(MAX_CREATURES);
    gg.setAttribute('position', new THREE.BufferAttribute(this.glowPos, 3).setUsage(THREE.DynamicDrawUsage));
    gg.setAttribute('color', new THREE.BufferAttribute(this.glowCol, 3).setUsage(THREE.DynamicDrawUsage));
    gg.setAttribute('size', new THREE.BufferAttribute(this.glowSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.glowMat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VS, fragmentShader: GLOW_FS, uniforms: { uScale: { value: 500 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.glow = new THREE.Points(gg, this.glowMat);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 3;
    this.scene.add(this.glow);

    // linie po terenie: zaznaczenie, wzrok, pędzel
    this.selRing = this.makeLoop('#ffffff', 0.95);
    this.visionRing = this.makeLoop('#ffffff', 0.35);
    this.brushRing = this.makeLoop('#ffffff', 0.7);
    this.hoverRing = this.makeLoop('#ffffff', 0.5);
  }

  makeLoop(color, opacity) {
    const n = 72;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const l = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
    l.renderOrder = 5;
    l.visible = false;
    l.frustumCulled = false;
    this.scene.add(l);
    return l;
  }
  // okrąg „przyklejony” do terenu
  placeLoop(loop, x, y, r, lift = 1.5) {
    const a = loop.geometry.attributes.position;
    const n = a.count;
    for (let i = 0; i < n; i++) {
      const t = i / n * Math.PI * 2;
      const px = x + Math.cos(t) * r, py = y + Math.sin(t) * r;
      a.setXYZ(i, px - HX, this.surfaceAt(px, py) + lift, py - HZ);
    }
    a.needsUpdate = true;
    loop.visible = true;
  }

  // ---------- Wysokość terenu ----------
  rebuildTerrain(sim) {
    const T = sim.terrain;
    this.T = T;
    this.tv = T.version;
    const wl = T.opts.waterLevel;
    if (this.seed !== T.seed) {
      this.seed = T.seed;
      this.nx = makeNoise(mulberry32(T.seed + 11));
      this.ny = makeNoise(mulberry32(T.seed + 23));
    }
    // wysokość „do wyświetlenia” per komórka, zgodna z biomem (np. namalowana woda jest niżej)
    const n = T.cols * T.rows;
    const de = this.dispElev = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let e = T.elev[i];
      const b = T.biome[i];
      if (BIOMES[b].water) e = Math.min(e, wl - (b === 0 ? 0.07 : 0.025));
      else {
        e = Math.max(e, wl + 0.012);
        if (b === 8) e = Math.max(e, wl + 0.3);
        if (b === 9) e = Math.max(e, wl + 0.42);
      }
      de[i] = e;
    }
    // siatka terenu
    const segX = T.cols * 2, segZ = T.rows * 2;
    if (!this.terrainMesh) {
      const g = new THREE.PlaneGeometry(WORLD_W, WORLD_H, segX, segZ);
      g.rotateX(-Math.PI / 2);
      this.terrainMesh = new THREE.Mesh(g, this.terrainMat);
      this.scene.add(this.terrainMesh);
    }
    const pos = this.terrainMesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + HX, z = pos.getZ(i) + HZ;
      pos.setY(i, this.groundAt(x, z));
    }
    pos.needsUpdate = true;
    this.terrainMesh.geometry.computeVertexNormals();
    this.terrainMesh.geometry.computeBoundingSphere();
    this.terrainMesh.geometry.computeBoundingBox();
    this.plantsTv = -1;
  }

  // Wysokość gruntu (dno morza pod wodą). Używa tego samego zniekształcenia co tekstura 2D,
  // żeby wybrzeża na teksturze pokrywały się z linią wody.
  groundAt(x, y) {
    const T = this.T;
    const u = clamp(x / CELL, 0, T.cols), v = clamp(y / CELL, 0, T.rows);
    const wu = u + (this.nx(u * 0.7, v * 0.7, 3) - 0.5) * 1.6;
    const wv = v + (this.ny(u * 0.7 + 5, v * 0.7, 3) - 0.5) * 1.6;
    const fx = clamp(wu - 0.5, 0, T.cols - 1), fy = clamp(wv - 0.5, 0, T.rows - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, T.cols - 1), y1 = Math.min(y0 + 1, T.rows - 1);
    const tx = fx - x0, ty = fy - y0;
    const de = this.dispElev, C = T.cols;
    let e = lerp(lerp(de[y0 * C + x0], de[y0 * C + x1], tx), lerp(de[y1 * C + x0], de[y1 * C + x1], tx), ty);
    const wl = T.opts.waterLevel;
    // biom pod tym punktem (jak na teksturze) — wymusza spójność brzegu
    const bc = clamp(Math.floor(wv), 0, T.rows - 1) * C + clamp(Math.floor(wu), 0, C - 1);
    const water = BIOMES[T.biome[bc]].water;
    if (water && e > wl - 0.01) e = wl - 0.01;
    if (!water && e < wl + 0.004) e = wl + 0.004;
    // krawędź świata opada w dół
    const edge = Math.min(x, y, WORLD_W - x, WORLD_H - y);
    let h = e >= wl ? (e - wl) * LAND_K : (e - wl) * SEA_K;
    if (edge < 2) h = Math.min(h, -12);
    return h;
  }
  // Wysokość, na której stoi obiekt (na wodzie unosi się na powierzchni)
  surfaceAt(x, y) { return Math.max(this.groundAt(x, y), 0); }

  // ---------- Kamera ----------
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    if (!r.width || !r.height) return;
    this.gl.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.glowMat.uniforms.uScale.value = r.height * this.gl.getPixelRatio() / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
  }
  fit() {
    this.controls.target.set(0, 0, 45);
    this.camera.position.set(0, 1720, 1350);
    this.controls.update();
  }
  followTarget(c) {
    const tx = c.x - HX, tz = c.y - HZ, ty = this.T ? this.surfaceAt(c.x, c.y) : 0;
    const t = this.controls.target;
    const dx = (tx - t.x) * 0.12, dy = (ty - t.y) * 0.12, dz = (tz - t.z) * 0.12;
    t.x += dx; t.y += dy; t.z += dz;
    this.camera.position.x += dx; this.camera.position.y += dy; this.camera.position.z += dz;
  }

  setNdc(sx, sy) {
    this.ndc.set(sx / this.w * 2 - 1, -(sy / this.h) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }
  // Ekran -> współrzędne świata symulacji
  toWorld(sx, sy) {
    if (!this.terrainMesh) return { x: -1, y: -1 };
    this.setNdc(sx, sy);
    const hit = this.raycaster.intersectObject(this.terrainMesh, false)[0];
    let p = hit ? hit.point : null;
    if (!p || p.y < 0) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const q = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(plane, q)) p = q;
    }
    if (!p) return { x: -1, y: -1 };
    return { x: p.x + HX, y: p.z + HZ };
  }
  // Stworek pod kursorem (trafienie w kulę albo najbliższy w pobliżu)
  pick(sx, sy, sim) {
    this.setNdc(sx, sy);
    this.bodyMesh.count = this.drawn.length;
    const hit = this.raycaster.intersectObject(this.bodyMesh, false)[0];
    if (hit && hit.instanceId !== undefined && this.drawn[hit.instanceId]) return this.drawn[hit.instanceId];
    const w = this.toWorld(sx, sy);
    const dist = this.camera.position.distanceTo(this.controls.target);
    return sim.creatureAt(w.x, w.y, clamp(dist / 120, 4, 20));
  }

  // ---------- Klatka ----------
  draw(sim) {
    const s = this.s;
    s.buildTerrain(sim);
    if (this.texKey !== s.texKey) {
      this.texKey = s.texKey;
      this.terrainTex.image = s.tex;
      this.terrainTex.needsUpdate = true;
    }
    if (this.T !== sim.terrain || this.tv !== sim.terrain.version) this.rebuildTerrain(sim);

    // zimą chłodniejsze światło
    const cold = clamp(-sim.tempOffset / 15, 0, 1), warm = clamp(sim.tempOffset / 15, 0, 1);
    this.sun.color.setRGB(1, lerp(0.95, 0.97, cold) - warm * 0.08, lerp(0.84, 1, cold) - warm * 0.15);
    this.waterMat.color.set(cold > 0.4 ? '#4b7a96' : '#1f5f8a');

    this.drawPlants(sim);
    this.drawMeat(sim);
    this.drawCreatures(sim);
    this.drawOverlays(sim);
    this.drawFx(sim);

    this.controls.update();
    this.gl.render(this.scene, this.camera);
  }

  drawPlants(sim) {
    const m = this.plantMesh, d = this.dummy, col = this.col;
    const n = Math.min(sim.plants.length, MAX_PLANTS);
    for (let i = 0; i < n; i++) {
      const p = sim.plants[i];
      if (p._tv !== this.tv) { p._h = this.surfaceAt(p.x, p.y); p._tv = this.tv; p._rot = Math.random() * 6.28; }
      const g = p.g;
      const sc = 0.9 + Math.sqrt(Math.max(0, p.energy)) * 0.55;
      d.position.set(p.x - HX, p._h, p.y - HZ);
      d.rotation.set(0, p._rot, 0);
      d.scale.set(sc * 0.75, sc * (g.water > 0.5 ? 0.45 : 1), sc * 0.75);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      const hue = lerp(lerp(105, 170, g.water), 290, g.tox * g.tox);
      const fill = clamp(p.energy / g.maxE, 0, 1);
      col.setHSL(hue / 360, (55 + g.tox * 25) / 100, (26 + fill * 22) / 100);
      m.setColorAt(i, col);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  drawMeat(sim) {
    const m = this.meatMesh, d = this.dummy;
    const n = Math.min(sim.meat.length, MAX_MEAT);
    for (let i = 0; i < n; i++) {
      const k = sim.meat[i];
      const r = 1 + Math.sqrt(k.energy) * 0.3;
      d.position.set(k.x - HX, this.surfaceAt(k.x, k.y) + r * 0.6, k.y - HZ);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(r);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  }

  drawCreatures(sim) {
    const s = this.s, d = this.dummy, col = this.col;
    const hl = s.highlightSpecies;
    const a = clamp(this.alpha ?? 1, 0, 1);
    const list = sim.creatures.slice(0, MAX_CREATURES);
    this.drawn = list;
    let rings = 0;
    const now = performance.now();
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      c.rx = c.px === undefined ? c.x : c.px + (c.x - c.px) * a;
      c.ry = c.py === undefined ? c.y : c.py + (c.y - c.py) * a;
      const base = this.surfaceAt(c.rx, c.ry);
      // lekkie podskakiwanie w ruchu
      const bob = c.speedNow > 0.2 ? Math.abs(Math.sin(now / 140 + c.id)) * c.r * 0.18 : 0;
      const y = base + c.r * 0.92 + bob;
      c._y3 = y;
      const dim = hl !== null && c.sp !== hl;
      // ciało
      d.position.set(c.rx - HX, y, c.ry - HZ);
      d.rotation.set(0, -c.angle, 0);
      d.scale.setScalar(c.r);
      d.updateMatrix();
      this.bodyMesh.setMatrixAt(i, d.matrix);
      col.setStyle(s.creatureColor(c, sim, 1));
      if (c.infected && Math.floor(now / 300) % 2) col.lerp(new THREE.Color('#b678ff'), 0.6);
      if (c.hurt && sim.tick - c.hurt < 8) col.lerp(new THREE.Color('#ffffff'), 0.5);
      if (dim) col.multiplyScalar(0.15);
      this.bodyMesh.setColorAt(i, col);
      // poświata
      this.glowPos[i * 3] = c.rx - HX; this.glowPos[i * 3 + 1] = y; this.glowPos[i * 3 + 2] = c.ry - HZ;
      this.glowCol[i * 3] = col.r; this.glowCol[i * 3 + 1] = col.g; this.glowCol[i * 3 + 2] = col.b;
      this.glowSize[i] = dim ? 0 : c.r * 5.5;
      // oko w kierunku ruchu
      const ex = c.rx + Math.cos(c.angle) * c.r * 0.82, ez = c.ry + Math.sin(c.angle) * c.r * 0.82;
      d.position.set(ex - HX, y + c.r * 0.3, ez - HZ);
      d.scale.setScalar(Math.max(0.6, c.r * 0.26) * (dim ? 0 : 1));
      d.updateMatrix();
      this.eyeMesh.setMatrixAt(i, d.matrix);
      // obręcz diety
      const dt = c.g.t.diet;
      if (dt > 0.33 && !dim) {
        d.position.set(c.rx - HX, y - c.r * 0.1, c.ry - HZ);
        d.scale.setScalar(c.r * 1.12);
        d.updateMatrix();
        this.ringMesh.setMatrixAt(rings, d.matrix);
        col.set(dt > 0.66 ? '#ff5a3c' : '#ffaa3c');
        if (c.attacking) col.set('#ff2020');
        this.ringMesh.setColorAt(rings, col);
        rings++;
      }
    }
    this.bodyMesh.count = list.length;
    this.eyeMesh.count = list.length;
    this.ringMesh.count = rings;
    for (const im of [this.bodyMesh, this.eyeMesh, this.ringMesh]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    const gg = this.glow.geometry;
    gg.setDrawRange(0, list.length);
    gg.attributes.position.needsUpdate = true;
    gg.attributes.color.needsUpdate = true;
    gg.attributes.size.needsUpdate = true;
  }

  drawOverlays(sim) {
    const s = this.s;
    const sel = s.selected && !s.selected.dead ? s.selected : null;
    if (sel && sel.g.t) {
      this.placeLoop(this.selRing, sel.rx ?? sel.x, sel.ry ?? sel.y, sel.r + 4 + Math.sin(performance.now() / 200));
      this.placeLoop(this.visionRing, sel.rx ?? sel.x, sel.ry ?? sel.y, sel.g.t.vision * sim.terrain.at(sel.x, sel.y).vision, 2);
    } else if (sel) {
      this.placeLoop(this.selRing, sel.x, sel.y, 6);
      this.visionRing.visible = false;
    } else { this.selRing.visible = false; this.visionRing.visible = false; }
    const hov = s.hover && s.hover !== sel && !s.hover.dead ? s.hover : null;
    if (hov) this.placeLoop(this.hoverRing, hov.rx ?? hov.x, hov.ry ?? hov.y, hov.r + 3);
    else this.hoverRing.visible = false;
    if (s.brush) this.placeLoop(this.brushRing, s.brush.x, s.brush.y, s.brush.r, 3);
    else this.brushRing.visible = false;
  }

  // efekty: rozchodzące się kręgi i błysk meteorytu
  drawFx(sim) {
    const s = this.s;
    s.ingestFx(sim);
    const now = performance.now();
    s.particles = s.particles.filter(p => now - p.born < (p.type === 'meteor' ? 1600 : 700));
    const want = s.particles.slice(-40);
    while (this.particles3d.length < want.length) {
      const loop = this.makeLoop('#ffffff', 1);
      loop.material.depthTest = true;
      const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: '#ffb060', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      flash.visible = false;
      this.scene.add(flash);
      this.particles3d.push({ loop, flash });
    }
    for (let i = 0; i < this.particles3d.length; i++) {
      const o = this.particles3d[i], p = want[i];
      if (!p) { o.loop.visible = false; o.flash.visible = false; continue; }
      const k = (now - p.born) / (p.type === 'meteor' ? 1600 : 700);
      const mat = o.loop.material;
      let r = 10;
      if (p.type === 'birth') { r = 4 + k * 18; mat.color.setHSL(p.hue / 360, 0.9, 0.75); }
      else if (p.type === 'death') { r = p.r * (1 + k * 1.5); mat.color.set(p.cause === 'predation' ? '#ff4646' : '#b4bec8'); }
      else if (p.type === 'spawn') { r = 3 + k * 22; mat.color.set('#4fd1c5'); }
      else if (p.type === 'smite') { r = p.r * (0.5 + k * 0.6); mat.color.set('#ffffff'); }
      else if (p.type === 'meteor') { r = p.r * (0.6 + k); mat.color.set('#ff9040'); }
      mat.opacity = 1 - k;
      this.placeLoop(o.loop, p.x, p.y, r, 2);
      if (p.type === 'meteor') {
        o.flash.visible = true;
        o.flash.position.set(p.x - HX, this.surfaceAt(p.x, p.y), p.y - HZ);
        o.flash.scale.setScalar(p.r * (0.3 + k * 0.7));
        o.flash.material.opacity = 0.8 * (1 - k);
      } else o.flash.visible = false;
    }
  }
}
