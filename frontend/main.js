/**
 * mediCrisis v9 — Chromatic Dispersion + Iridescence Glass DNA
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let scene, camera, renderer, dnaModel, smoother, gridMesh;
let clock = new THREE.Clock();
let camInitPos = new THREE.Vector3(), camInitTarget = new THREE.Vector3();
let mouse = new THREE.Vector2(0, 0), mouseSpeed = 0;
let dnaMeshes = [], shaderRefs = [];
let gridRT, bgScene, bgCamera, glassMat;
let cellInstancedMesh, dummy = new THREE.Object3D();
let isRendering = true;
let cellData = [];

// ── GRID SHADER ──
const gridVS = `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.0);}`;
const gridFS = `
uniform float uTime; uniform vec2 uMouse,uResolution; varying vec2 vUv;
void main(){
  float a=uResolution.x/uResolution.y, gs=35.0;
  vec2 uv=vec2(vUv.x*a,vUv.y)*gs;
  vec2 mg=vec2((uMouse.x*.5+.5)*a,uMouse.y*.5+.5)*gs;
  vec2 cid=floor(uv), cc=cid+.5;
  float dm=distance(cc,mg);
  float wave=sin(dm*1.2-uTime*3.)*.06*smoothstep(12.,0.,dm);
  float push=smoothstep(8.,0.,dm);
  vec2 pd=normalize(cc-mg+.001);
  vec2 cl=fract(uv)-pd*push*.18-pd*wave;
  float hs=(.85-push*.2)*.5, bw=.025;
  vec2 fc=abs(cl-.5);
  float o=step(fc.x,hs)*step(fc.y,hs)-step(fc.x,hs-bw)*step(fc.y,hs-bw);
  vec3 bg=vec3(1.);
  vec3 ln=vec3(0.);
  float la=0.5+push*.5;
  gl_FragColor=vec4(mix(bg,ln,o*la),1.);
}`;

function createGrid() {
  const m = new THREE.ShaderMaterial({
    vertexShader: gridVS, fragmentShader: gridFS,
    uniforms: {
      uTime: { value: 0 }, uMouse: { value: new THREE.Vector2() },
      uResolution: { value: new THREE.Vector2(innerWidth, innerHeight) }
    },
    depthWrite: false, depthTest: false
  });
  gridMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
  gridMesh.frustumCulled = false;
  return gridMesh;
}

function initRenderer() {
  const c = document.getElementById('three-canvas');
  renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  gridRT = new THREE.WebGLRenderTarget(innerWidth, innerHeight);
}

function initScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 2000);

  // Rich procedural environment for glass refraction
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x111111);

  // Multi-color point lights create rainbow refraction in glass
  const colors = [0xff3333, 0x33ff66, 0x3366ff, 0xffcc00, 0xff33ff, 0x33ffff];
  const positions = [[5, 5, 5], [-5, 5, -3], [0, -5, 5], [5, -3, -5], [-5, 0, 5], [3, 5, -5]];
  colors.forEach((col, i) => {
    const pl = new THREE.PointLight(col, 30, 50);
    pl.position.set(...positions[i]);
    envScene.add(pl);
  });
  // Neutral fill
  envScene.add(new THREE.AmbientLight(0xffffff, 0.3));
  const dirL = new THREE.DirectionalLight(0xffffff, 3);
  dirL.position.set(2, 4, 3);
  envScene.add(dirL);

  // Small sphere to scatter env light
  const envGeo = new THREE.SphereGeometry(0.1, 8, 8);
  const envMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x444444 });
  const envSph = new THREE.Mesh(envGeo, envMat);
  envScene.add(envSph);

  scene.environment = pmrem.fromScene(envScene, 0, 0.1, 100).texture;
  pmrem.dispose();
}

function initSmoothScroll() {
  gsap.registerPlugin(ScrollTrigger, ScrollSmoother);
  smoother = ScrollSmoother.create({
    wrapper: '#smooth-wrapper',
    content: '#smooth-content',
    smooth: 2,
    effects: true
  });
}

function loadModel() {
  return new Promise((res, rej) => {
    new GLTFLoader().load('models/DNA3.glb', gltf => {
      const model = gltf.scene;
      let bc = null, lc = 0; const rm = [];
      model.traverse(c => {
        if (c.isCamera && !bc) bc = c;
        if (c.isLight) lc++;
        if (c.isMesh) {
          const n = c.name.toLowerCase(), g = c.geometry;
          if (n.includes('plane') || n.includes('bg') || n.includes('floor') || n.includes('background')) { rm.push(c) }
          else if (g && g.attributes.position && g.attributes.position.count <= 6) { rm.push(c) }
          else if (g) {
            g.computeBoundingBox(); const s = new THREE.Vector3(); g.boundingBox.getSize(s);
            if (Math.min(s.x, s.y, s.z) < .1 && Math.max(s.x, s.y, s.z) > 3) rm.push(c);
          }
        }
      });
      rm.forEach(m => { m.removeFromParent() });

      if (bc) {
        camera = bc; camera.aspect = innerWidth / innerHeight;
        const d = new THREE.Vector3(); camera.getWorldDirection(d);
        camera.position.addScaledVector(d, -camera.position.length() * .10);
        camera.updateProjectionMatrix();
      }
      camInitPos.copy(camera.position); camera.getWorldDirection(camInitTarget);

      if (lc === 0) {
        scene.add(new THREE.AmbientLight(0xffffff, .5));
        const k = new THREE.DirectionalLight(0xffffff, 1.5); k.position.set(10, 15, 10); scene.add(k);
        const f = new THREE.DirectionalLight(0xffffff, .5); f.position.set(-8, -5, 8); scene.add(f);
        const b = new THREE.DirectionalLight(0xffffff, .3); b.position.set(0, 5, -10); scene.add(b);
      }

      // ═══ CHROMATIC DISPERSION + IRIDESCENCE GLASS ═══
      glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.2,
        transmission: 1.0,
        ior: 1.2,
        thickness: 1.5,
        dispersion: 15.0,
        envMapIntensity: 2.0,
        iridescence: 1.0,
        iridescenceIOR: 1.3,
        iridescenceThicknessRange: [100, 400],
        clearcoat: 1.0,
        clearcoatRoughness: 0.0,
        transparent: true,
        side: THREE.DoubleSide,
      });

      // Inject per-node micro-pulse
      glassMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
          #include <begin_vertex>
          vec3 nid=floor(position*1.5);
          float ph=fract(sin(dot(nid,vec3(12.9898,78.233,45.164)))*43758.5453);
          float spd=0.6+ph*1.4;
          float pulse=sin(uTime*spd+ph*6.2831)*0.005;
          transformed+=normal*pulse;
        `);
        shaderRefs.push(shader);
      };

      model.traverse(c => {
        if (c.isMesh) {
          c.material = glassMat.clone();
          c.material.onBeforeCompile = glassMat.onBeforeCompile;
          c.castShadow = true;
          dnaMeshes.push(c);
        }
      });

      scene.add(model); dnaModel = model;
      console.log(`[mediCrisis] DNA: ${dnaMeshes.length} meshes`);
      res(gltf);
    }, undefined, rej);
  });
}

function initScrollAnimations() {
  const t = '.scroll-content';

  // 1. Setup Initial States
  gsap.set('#features', { visibility: 'hidden', opacity: 0 });
  gsap.set('#cta-wrapper', { visibility: 'hidden', clipPath: 'circle(0vmax at 50% 50%)' });
  gsap.set('#features-left', { x: -150, opacity: 0 });
  gsap.set('#features-right', { x: 150, opacity: 0 });
  gsap.set('#features-grid .feature-card', { y: 150, opacity: 0 });
  gsap.set('#cta-content', { y: 50, opacity: 0, scale: 0.95 });

  // Background Animations (Increased Zoom)
  if (camera) {
    gsap.to(camera.position, {
      x: camInitPos.x + camInitTarget.x * 48, y: camInitPos.y + camInitTarget.y * 48,
      z: camInitPos.z + camInitTarget.z * 48, ease: 'none',
      scrollTrigger: { trigger: t, start: 'top top', end: '+=4000', scrub: 1.5 }
    });
  }
  if (dnaModel) {
    gsap.to(dnaModel.rotation, {
      y: dnaModel.rotation.y + Math.PI * 6, ease: 'none',
      scrollTrigger: { trigger: t, start: 'top top', end: '+=4000', scrub: 1.5 }
    });
  }

  // Master Slide Timeline
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: t,
      start: 'top top',
      end: '+=4000', // Increased scroll distance
      pin: true,
      scrub: 1,
      snap: {
        snapTo: 'labels',
        duration: { min: 0.3, max: 0.8 },
        ease: 'power2.inOut'
      }
    }
  });

  // SLIDE 1 (Hero)
  tl.addLabel('slide1')
    .to({}, { duration: 0.5 }); // Pause

  // TRANSITION: Hero Out
  tl.to('#hero-headline', { rotationX: -60, y: -150, z: -400, opacity: 0, ease: 'power2.inOut', duration: 1 }, 'slide1_out')
    .to('#hero-texts', { opacity: 0, x: -50, ease: 'power2.inOut', duration: 0.8 }, 'slide1_out')
    .to('#hero-buttons', { opacity: 0, scale: 0.9, y: 50, ease: 'power2.inOut', duration: 0.8 }, 'slide1_out')
    .to('#hero-stat', { opacity: 0, x: 100, ease: 'power2.inOut', duration: 0.8 }, 'slide1_out')
    .to('#hero-scroll', { opacity: 0, y: 50, ease: 'power2.inOut', duration: 0.5 }, 'slide1_out')
    .set('#hero', { visibility: 'hidden' });

  // TRANSITION: Features In
  tl.set('#features', { visibility: 'visible' })
    .to('#features', { opacity: 1, duration: 0.1 }, 'slide2_in')
    .to('#features-left', { x: 0, opacity: 1, ease: 'power3.out', duration: 1 }, 'slide2_in')
    .to('#features-right', { x: 0, opacity: 1, ease: 'power3.out', duration: 1 }, 'slide2_in')
    .to('#features-grid .feature-card', { y: 0, opacity: 1, stagger: 0.15, ease: 'back.out(1.2)', duration: 1 }, 'slide2_in');

  // SLIDE 2 (Features)
  tl.addLabel('slide2')
    .to({}, { duration: 0.5 }); // Pause

  // TRANSITION: Features Out
  tl.to('#features', { opacity: 0, scale: 0.95, duration: 1, ease: 'power2.inOut' }, 'slide2_out')
    .set('#features', { visibility: 'hidden' });

  // TRANSITION: CTA In
  tl.set('#cta-wrapper', { visibility: 'visible' })
    .set('#cta-ring', { visibility: 'visible', width: 0, height: 0, opacity: 0 })
    .to('#cta-wrapper', { clipPath: 'circle(150vmax at 50% 50%)', ease: 'power2.inOut', duration: 1.5 }, 'slide3_in')
    .to('#cta-ring', { width: '300vmax', height: '300vmax', ease: 'power2.inOut', duration: 1.5 }, 'slide3_in')
    .to('#cta-ring', { opacity: 1, duration: 0.3 }, 'slide3_in+=0.3')
    .to('#cta-ring', { opacity: 0, duration: 0.3 }, 'slide3_in+=1.2')
    .to('#cta-content', { y: 0, opacity: 1, scale: 1, duration: 1, ease: 'power3.out' }, 'slide3_in+=0.3');

  // SLIDE 3 (CTA)
  tl.addLabel('slide3')
    .to({}, { duration: 0.5 }); // Pause

  ScrollTrigger.create({ start: 80, onUpdate: s => { document.getElementById('navbar').classList.toggle('scrolled', s.scroll() > 80) } });

  ScrollTrigger.create({
    trigger: '#hero',
    start: 'top center',
    end: 'bottom center',
    onToggle: self => {
      if (self.isActive) {
        document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
        document.getElementById('nav-home')?.classList.add('active');
      }
    }
  });

  // Elastic Magnetic Buttons
  document.querySelectorAll('.magnetic-btn').forEach(btn => {
    btn.addEventListener('mousemove', e => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      gsap.to(btn, { x: x * 0.4, y: y * 0.4, duration: 0.4, ease: 'power3.out' });
    });
    btn.addEventListener('mouseleave', () => {
      gsap.to(btn, { x: 0, y: 0, duration: 0.8, ease: 'elastic.out(1, 0.3)' });
    });
  });

  // ═══ INSTANCED MESH CELLULAR BACKGROUND ═══
  const cellCount = 800;
  const cellGeo = new THREE.IcosahedronGeometry(0.15, 1);
  const cellMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, transmission: 0.9, opacity: 1, metalness: 0, roughness: 0.2, ior: 1.5,
    thickness: 0.5, specularIntensity: 1, envMapIntensity: 1.5, transparent: true
  });
  cellInstancedMesh = new THREE.InstancedMesh(cellGeo, cellMat, cellCount);
  cellInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  
  for(let i = 0; i < cellCount; i++) {
    const x = (Math.random() - 0.5) * 40;
    const y = (Math.random() - 0.5) * 40;
    const z = (Math.random() - 0.5) * 40 - 10;
    const speed = 0.05 + Math.random() * 0.1;
    const phase = Math.random() * Math.PI * 2;
    cellData.push({x, y, z, speed, phase});
    
    dummy.position.set(x, y, z);
    dummy.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, 0);
    const scale = 0.2 + Math.random() * 0.8;
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    cellInstancedMesh.setMatrixAt(i, dummy.matrix);
  }
  scene.add(cellInstancedMesh);
}

function animate() {
  requestAnimationFrame(animate);
  if (!isRendering) return;
  const t = clock.getElapsedTime();

  // Per-node pulse
  shaderRefs.forEach(s => { if (s.uniforms.uTime) s.uniforms.uTime.value = t; });

  // Mouse-reactive dispersion: faster mouse = more chromatic split
  if (glassMat) {
    const targetDisp = 3.0 + mouseSpeed * 0.15;
    glassMat.dispersion += (targetDisp - glassMat.dispersion) * 0.08;
    mouseSpeed *= 0.92; // decay
  }

  // Grid
  if (gridMesh) {
    gridMesh.material.uniforms.uTime.value = t;
    gridMesh.material.uniforms.uMouse.value.copy(mouse);
  }

  // Animate InstancedMesh Cells
  if (cellInstancedMesh) {
    for (let i = 0; i < 800; i++) {
      const data = cellData[i];
      data.y += data.speed * 0.2;
      if (data.y > 20) data.y = -20;
      dummy.position.set(data.x + Math.sin(t * data.speed + data.phase) * 2, data.y, data.z);
      dummy.rotation.set(t * data.speed, t * data.speed * 0.5, 0);
      dummy.scale.setScalar(0.5 + Math.sin(t * 2 + data.phase) * 0.2);
      dummy.updateMatrix();
      cellInstancedMesh.setMatrixAt(i, dummy.matrix);
    }
    cellInstancedMesh.instanceMatrix.needsUpdate = true;
  }

  // Render grid to RT for transmission refraction
  renderer.setRenderTarget(gridRT);
  renderer.render(bgScene, bgCamera);
  renderer.setRenderTarget(null);
  scene.background = gridRT.texture;

  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
  if (gridMesh) gridMesh.material.uniforms.uResolution.value.set(innerWidth, innerHeight);
  gridRT.setSize(innerWidth, innerHeight);
}

function hideLoader() {
  gsap.to('#loader', {
    opacity: 0, duration: .8, ease: 'power2.inOut',
    onComplete: () => { document.getElementById('loader').style.display = 'none' }
  });
}

async function init() {
  console.log('[mediCrisis] v10 — Light Mode + ScrollSmoother');
  initRenderer(); initScene(); initSmoothScroll();
  bgScene = new THREE.Scene(); bgCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  bgScene.add(createGrid());
  try { await loadModel() } catch (e) { console.error(e) }
  initScrollAnimations(); animate(); hideLoader();
  addEventListener('resize', onResize);

  // Custom VR Cursor Physics
  const vrCursor = document.getElementById('vr-cursor');
  let cx = 0, cy = 0;
  addEventListener('mousemove', e => {
    mouse.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / innerHeight) * 2 + 1;
    mouseSpeed = Math.min(Math.abs(e.movementX) + Math.abs(e.movementY), 50);
    cx = e.clientX; cy = e.clientY;
  });
  gsap.ticker.add(() => {
    gsap.set(vrCursor, { x: cx, y: cy });
  });

  // VR Cursor Hover States
  document.querySelectorAll('a, button, .magnetic-btn, .feature-card').forEach(el => {
    el.addEventListener('mouseenter', () => vrCursor.classList.add('hover'));
    el.addEventListener('mouseleave', () => vrCursor.classList.remove('hover'));
  });

  // ═══ INTERSECTION OBSERVER FOR PERFORMANCE ═══
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      isRendering = entry.isIntersecting;
    });
  }, { threshold: 0.01 });
  
  const targetSection = document.getElementById('hero') || document.body;
  observer.observe(targetSection);

  console.log('[mediCrisis] Ready ✓');
}
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
