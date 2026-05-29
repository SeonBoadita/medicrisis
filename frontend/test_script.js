
    import * as THREE from 'three';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

    /* ═══════════════════════════════════════════
       GRID GLSL SHADER — identical to main.js
    ═══════════════════════════════════════════ */
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
  float la=0.15+push*.7; /* Reduced base alpha, much brighter on hover (push) */
  gl_FragColor=vec4(mix(bg,ln,o*la),1.);
}`;

    let scene, camera, renderer, gridMesh, gridRT, bgScene, bgCamera;
    let mouse = new THREE.Vector2(0, 0), mouseSpeed = 0;
    let clock = new THREE.Clock();

    function initThree() {
      try {
        const canvas = document.getElementById('three-canvas');
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
        renderer.setSize(innerWidth, innerHeight);
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      } catch (e) {
        console.warn("WebGL initialization failed, falling back to CSS rendering", e);
        return;
      }

      gridRT = new THREE.WebGLRenderTarget(innerWidth, innerHeight);

      // BG scene with grid shader
      bgScene  = new THREE.Scene();
      bgCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const gridMat = new THREE.ShaderMaterial({
        vertexShader: gridVS,
        fragmentShader: gridFS,
        uniforms: {
          uTime:       { value: 0 },
          uMouse:      { value: new THREE.Vector2() },
          uResolution: { value: new THREE.Vector2(innerWidth, innerHeight) }
        },
        depthWrite: false, depthTest: false
      });
      gridMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), gridMat);
      gridMesh.frustumCulled = false;
      bgScene.add(gridMesh);

      // Main scene — transparent so grid shows through
      scene  = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 2000);
        camera.position.set(0, 0, 15); // Move camera back significantly // Move camera back slightly to see full human

      // AAA Wireframe Lighting & Environment
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
      scene.add(ambientLight);

      const mKeyLight = new THREE.DirectionalLight(0xffffff, 2.0);
      mKeyLight.position.set(5, 5, 5);
      scene.add(mKeyLight);

      const mRimLight = new THREE.PointLight(0x0a66c2, 5, 20);
      mRimLight.position.set(-3, 2, -3);
      scene.add(mRimLight);

            window.loadedBgModel = null;
      const loader = new GLTFLoader();
      loader.load('models/VrHuman.glb', (gltf) => {
        window.loadedBgModel = gltf.scene;

        // Apply black wireframe material
        window.loadedBgModel.traverse((child) => {
          if (child.isMesh) {
            child.material = new THREE.MeshStandardMaterial({
              color: 0x000000,
              wireframe: true,
              transparent: true,
              opacity: 0.40, // Reduced to 40% alpha
              emissive: 0x000000
            });
          }
        });

        // Center model and fix scale (less zoomed in)
        const box = new THREE.Box3().setFromObject(window.loadedBgModel);
        const center = box.getCenter(new THREE.Vector3());
        window.loadedBgModel.position.sub(center);
        
        window.loadedBgModel.scale.set(0.5, 0.5, 0.5); // Scaled down significantly
        window.loadedBgModel.position.y -= 0.5; 
        
        // Push the model to the right end, but a bit more left (x = 3.5)
        window.loadedBgModel.position.x += 3.5; 
        
        window.loadedBgModel.rotation.y = -0.5;

        scene.add(window.loadedBgModel);

        // AAA Scroll Animation for the Camera & Model
        setTimeout(() => {
          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: 'body',
              start: 'top top',
              end: 'bottom bottom',
              scrub: 1
            }
          });

          // Camera starts centered, pans right and down as you scroll
          tl.fromTo(camera.position,
              { x: 0, y: 0, z: 10 }, // 1st frame: more zoomed in than before (z=10)
              { x: 3.5, y: -1, z: 6, ease: 'power1.inOut' } // Last frame: center on model (x=3.5) and more zoomed in (z=6)
          );

          // Model rotates to face the other way to create a parallax wrap-around effect
          tl.to(window.loadedBgModel.rotation, {
            y: 1.5,
            ease: 'none'
          }, 0);
        }, 500); // Small timeout to ensure ScrollTrigger is registered
      });

      window.addEventListener('resize', () => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
        gridMesh.material.uniforms.uResolution.value.set(innerWidth, innerHeight);
        gridRT.setSize(innerWidth, innerHeight);
      });
    }

    function animateThree() {
      requestAnimationFrame(animateThree);
      if (!renderer) return;
      const t = clock.getElapsedTime();
      gridMesh.material.uniforms.uTime.value  = t;
      gridMesh.material.uniforms.uMouse.value.copy(mouse);
      renderer.setRenderTarget(gridRT);
      renderer.render(bgScene, bgCamera);
      renderer.setRenderTarget(null);
      scene.background = gridRT.texture;
            // Model is now animated purely by GSAP scroll
      renderer.render(scene, camera);
    }

    /* ═══════════════════════════════════════════
       VR CURSOR — identical to main.js
    ═══════════════════════════════════════════ */
    const vrCursor = document.getElementById('vr-cursor');
    let cx = 0, cy = 0;

    window.addEventListener('mousemove', e => {
      mouse.x = (e.clientX / innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / innerHeight) * 2 + 1;
      mouseSpeed = Math.min(Math.abs(e.movementX) + Math.abs(e.movementY), 50);
      cx = e.clientX; cy = e.clientY;
    });

    /* ═══════════════════════════════════════════
       GSAP + SCROLL
    ═══════════════════════════════════════════ */
    gsap.registerPlugin(ScrollTrigger, ScrollSmoother);

    const smoother = ScrollSmoother.create({
      wrapper: '#smooth-wrapper',
      content: '#smooth-content',
      smooth: 2,
      effects: true
    });

    gsap.ticker.add(() => {
      gsap.set(vrCursor, { x: cx, y: cy });
    });

    /* ─── Cursor hover states ─── */
    function bindCursorHovers(root) {
      root.querySelectorAll('a, button, .magnetic-btn, .feature-card').forEach(el => {
        el.addEventListener('mouseenter', () => vrCursor.classList.add('hover'));
        el.addEventListener('mouseleave', () => vrCursor.classList.remove('hover'));
      });
    }
    bindCursorHovers(document);

    /* ─── Magnetic buttons ─── */
    function bindMagnetic(root) {
      root.querySelectorAll('.magnetic-btn').forEach(btn => {
        btn.addEventListener('mousemove', e => {
          const r = btn.getBoundingClientRect();
          const x = e.clientX - r.left - r.width / 2;
          const y = e.clientY - r.top - r.height / 2;
          gsap.to(btn, { x: x * 0.4, y: y * 0.4, duration: 0.4, ease: 'power3.out' });
        });
        btn.addEventListener('mouseleave', () => {
          gsap.to(btn, { x: 0, y: 0, duration: 0.8, ease: 'elastic.out(1,0.3)' });
        });
      });
    }
    bindMagnetic(document);

    /* ─── Navbar scroll state ─── */
    ScrollTrigger.create({
      start: 80,
      onUpdate: s => { document.getElementById('navbar')?.classList.toggle('scrolled', s.scroll() > 80); }
    });

    /* ─── GSAP — page entrance ─── */
    gsap.set('#demo-eyebrow',  { opacity: 0, y: 20 });
    gsap.set('#demo-title',    { opacity: 0, y: 40, rotationX: -15, transformOrigin: 'center bottom', transformStyle: 'preserve-3d' });
    gsap.set('#demo-subtitle', { opacity: 0, y: 20 });
    gsap.set('#demo-cta',      { opacity: 0, y: 40 });

    const enterTl = gsap.timeline({ delay: 0.25 });
    enterTl
      .to('#demo-eyebrow',  { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' })
      .to('#demo-title',    { opacity: 1, y: 0, rotationX: 0, duration: 0.95, ease: 'power3.out' }, '-=0.45')
      .to('#demo-subtitle', { opacity: 1, y: 0, duration: 0.65, ease: 'power3.out' }, '-=0.55');

    /* ─── Shadow Cards Scroll Reveal ─── */
    gsap.set('#vid-shadow-1', { rotation: 0, x: 0, y: 0 });
    gsap.set('#vid-shadow-2', { rotation: 0, x: 0, y: 0 });
    
    ScrollTrigger.create({
      trigger: '#video-outer',
      start: 'top 75%',
      end: 'top 30%',
      scrub: 1,
      animation: gsap.timeline()
        .to('#vid-shadow-1', { rotation: -3, x: -35, y: 15, opacity: 1, duration: 1.2, ease: 'back.out(1.2)' })
        .to('#vid-shadow-2', { rotation: 3, x: 35, y: 15, opacity: 0.85, duration: 1.2, ease: 'back.out(1.2)' }, '<0.1')
    });

    // Scroll scrub — Hero fade out & shrink
    gsap.to('#demo-hero', {
      opacity: 0, y: -40, scale: 0.85, transformOrigin: 'center center',
      ease: 'none',
      scrollTrigger: { trigger: '#demo-hero', start: 'top top', end: 'bottom top', scrub: true }
    });

    // Scroll scrub — CTA reveal
    gsap.to('#demo-cta', {
      opacity: 1, y: 0,
      ease: 'power3.out',
      scrollTrigger: { trigger: '#demo-cta', start: 'top 85%', end: 'top 50%', scrub: 1 }
    });

    // Scroll scrub — video parallax lift
    gsap.to('#video-outer', {
      y: -20,
      ease: 'none',
      scrollTrigger: { trigger: '#demo-video-section', start: 'top 80%', end: 'bottom top', scrub: 2 }
    });

    /* ═══════════════════════════════════════════
       VIDEO PLAYER LOGIC
    ═══════════════════════════════════════════ */
    const video       = document.getElementById('demo-video');
    const overlay     = document.getElementById('video-overlay');
    const controls    = document.getElementById('vid-controls');
    const overlayBtn  = document.getElementById('overlay-play-btn');
    const ppBtn       = document.getElementById('pp-btn');
    const ppIcon      = document.getElementById('pp-icon');
    const progressTrk = document.getElementById('progress-track');
    const progressFil = document.getElementById('progress-fill');
    const timeLbl     = document.getElementById('time-lbl');
    const muteBtn     = document.getElementById('mute-btn');
    const volIcon     = document.getElementById('vol-icon');
    const volRange    = document.getElementById('vol-range');
    const pipBtn      = document.getElementById('pip-btn');
    const fsBtn       = document.getElementById('fs-btn');
    const fsIcon      = document.getElementById('fs-icon');

    const fmt = s => { const m = Math.floor(s/60), sec = Math.floor(s%60); return m+':'+(sec<10?'0':'')+sec; };

    function setPlay(playing) {
      ppIcon.className = playing ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    }

    overlayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      overlay.classList.add('hidden');
      controls.classList.add('pinned');
      video.play().then(() => {
        setPlay(true);
        setTimeout(() => controls.classList.remove('pinned'), 2800);
      }).catch(err => console.error("Video play error:", err));
    });

    ppBtn.addEventListener('click', () => {
      if (video.paused) { video.play(); setPlay(true); }
      else { video.pause(); setPlay(false); }
    });

    // Click on video body
    document.getElementById('video-shell').addEventListener('click', e => {
      if (overlay.classList.contains('hidden') && !e.target.closest('.vid-controls')) {
        if (video.paused) { video.play(); setPlay(true); }
        else { video.pause(); setPlay(false); }
      }
    });

    video.addEventListener('timeupdate', () => {
      if (!video.duration) return;
      progressFil.style.width = (video.currentTime / video.duration * 100) + '%';
      timeLbl.textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration);
    });

    video.addEventListener('ended', () => {
      setPlay(false);
      overlay.classList.remove('hidden');
      controls.classList.remove('pinned');
      video.currentTime = 0;
    });

    // Scrub
    let dragging = false;
    const scrub = e => {
      const r = progressTrk.getBoundingClientRect();
      video.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * video.duration;
    };
    progressTrk.addEventListener('mousedown', e => { dragging = true; scrub(e); });
    document.addEventListener('mousemove', e => { if (dragging) scrub(e); });
    document.addEventListener('mouseup', () => { dragging = false; });

    // Volume
    volRange.addEventListener('input', () => {
      video.volume = parseFloat(volRange.value);
      video.muted = video.volume === 0;
      updateVolIcon();
    });
    muteBtn.addEventListener('click', () => {
      video.muted = !video.muted;
      volRange.value = video.muted ? 0 : video.volume;
      updateVolIcon();
    });
    function updateVolIcon() {
      volIcon.className = video.muted || video.volume === 0
        ? 'fa-solid fa-volume-xmark'
        : video.volume < 0.5 ? 'fa-solid fa-volume-low' : 'fa-solid fa-volume-high';
    }

    // PiP
    pipBtn.addEventListener('click', async () => {
      try {
        document.pictureInPictureElement
          ? await document.exitPictureInPicture()
          : await video.requestPictureInPicture();
      } catch {}
    });

    // Fullscreen — move vr-cursor into shell so it renders inside fullscreen viewport
    const shell = document.getElementById('video-shell');
    fsBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        shell.requestFullscreen().catch(() => {});
        fsIcon.className = 'fa-solid fa-compress';
      } else {
        document.exitFullscreen();
        fsIcon.className = 'fa-solid fa-expand';
      }
    });
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement === shell) {
        // Reparent cursor into the fullscreen element so it paints on top
        shell.appendChild(vrCursor);
        fsIcon.className = 'fa-solid fa-compress';
      } else {
        // Restore cursor to body
        document.body.appendChild(vrCursor);
        fsIcon.className = 'fa-solid fa-expand';
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space')       { e.preventDefault(); ppBtn.click(); }
      if (e.code === 'KeyF')        fsBtn.click();
      if (e.code === 'KeyM')        muteBtn.click();
      if (e.code === 'ArrowRight')  video.currentTime = Math.min(video.duration, video.currentTime + 5);
      if (e.code === 'ArrowLeft')   video.currentTime = Math.max(0, video.currentTime - 5);
    });

    /* ═══════════════════════════════════════════
       INIT
    ═══════════════════════════════════════════ */
    initThree();
    animateThree();

    // Fade out loader
    gsap.to('#loader', {
      opacity: 0, duration: 0.8, delay: 0.3, ease: 'power2.inOut',
      onComplete: () => { document.getElementById('loader').style.display = 'none'; }
    });

    // Re-bind nav hover after web component renders
    setTimeout(() => {
      bindCursorHovers(document);
      bindMagnetic(document);
    }, 300);
  