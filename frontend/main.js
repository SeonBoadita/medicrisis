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
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
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
  if (camera) {
    gsap.to(camera.position, {
      x: camInitPos.x + camInitTarget.x * 20, y: camInitPos.y + camInitTarget.y * 20,
      z: camInitPos.z + camInitTarget.z * 20, ease: 'none',
      scrollTrigger: { trigger: t, start: 'top top', end: 'bottom bottom', scrub: 1.5 }
    });
  }
  if (dnaModel) {
    gsap.to(dnaModel.rotation, {
      y: dnaModel.rotation.y + Math.PI * 4 + Math.PI / 4, ease: 'none',
      scrollTrigger: { trigger: t, start: 'top top', end: 'bottom bottom', scrub: 1.5 }
    });
  }
  gsap.fromTo('#hero-content', { opacity: 1, y: 0 }, {
    opacity: 0, y: -60, ease: 'none',
    scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom 30%', scrub: true }
  });
  gsap.from('#features-header', {
    y: 50, opacity: 0, duration: .8,
    scrollTrigger: { trigger: '#features-header', start: 'top 85%', toggleActions: 'play reverse play reverse' }
  });
  gsap.from('#features-grid .feature-card', {
    y: 60, opacity: 0, stagger: .15, duration: .6, ease: 'power3.out',
    scrollTrigger: { trigger: '#features-grid', start: 'top 85%', toggleActions: 'play reverse play reverse' }
  });
  gsap.from('#cta-content', {
    y: 50, opacity: 0, scale: .95, duration: .8,
    scrollTrigger: { trigger: '#cta', start: 'top 80%', toggleActions: 'play reverse play reverse' }
  });
  ScrollTrigger.create({ start: 80, onUpdate: s => { document.getElementById('navbar').classList.toggle('scrolled', s.scroll() > 80) } });
}

function animate() {
  requestAnimationFrame(animate);
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

  // Render grid to RT for transmission refraction
  renderer.setRenderTarget(gridRT);
  renderer.render(bgScene, bgCamera);
  renderer.setRenderTarget(null);
  scene.background = gridRT.texture;

  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
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
  let _mf = 0;
  addEventListener('mousemove', e => {
    if (_mf++ % 2) return;
    mouse.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / innerHeight) * 2 + 1;
    mouseSpeed = Math.min(Math.abs(e.movementX) + Math.abs(e.movementY), 50);
  });
  console.log('[mediCrisis] Ready ✓');
}
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
