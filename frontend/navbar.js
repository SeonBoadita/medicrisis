class MedicrisisNavbar extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback() {
    // Only render once
    if (this.rendered) return;
    this.rendered = true;

    const currentPath = window.location.pathname;
    
    // Determine which page is active
    const isHome = currentPath.endsWith('index.html') || currentPath.endsWith('/');
    const isTeam = currentPath.endsWith('team.html');
    const isLeaderboard = currentPath.endsWith('leaderboard.html');
    const isAdmin = currentPath.endsWith('admin.html');
    const isDemo = currentPath.endsWith('demo.html');
    
    // Grab any custom content the user put inside the tag
    const customContent = this.innerHTML.trim();
    
    // Determine the right CTA button based on the page (if no custom content provided)
    let rightContent = customContent;
    if (!rightContent) {
      if (isHome) {
        rightContent = `
          <a href="#cta" class="hover-trigger magnetic-btn relative overflow-hidden text-[10px] sm:text-xs bg-black text-white px-6 py-3 rounded-full font-bold tracking-widest uppercase transition-all duration-300 group shadow-[0_10px_20px_rgba(0,0,0,.15)] hover:shadow-[0_15px_30px_rgba(0,0,0,.3)] hover:scale-105 inline-block font-doto">
            <span class="relative z-10 flex items-center gap-2"><i class="fa-solid fa-play text-[10px]"></i> Launch VR</span>
            <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-[150%] group-hover:animate-[shimmer_1.5s_infinite] skew-x-[-20deg]"></div>
          </a>
        `;
      } else {
        rightContent = `
          <a href="index.html" class="hover-trigger magnetic-btn relative overflow-hidden text-[10px] sm:text-xs bg-black text-white px-6 py-3 rounded-full font-bold tracking-widest uppercase transition-all duration-300 group shadow-[0_10px_20px_rgba(0,0,0,.1)] hover:shadow-[0_15px_30px_rgba(0,0,0,.2)] hover:scale-105 inline-block font-doto">
            <span class="relative z-10 flex items-center gap-2"><i class="fa-solid fa-arrow-left"></i> Back</span>
            <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-[150%] group-hover:animate-[shimmer_1.5s_infinite] skew-x-[-20deg]"></div>
          </a>
        `;
      }
    }

    this.innerHTML = `
      <nav class="navbar flex items-center justify-between w-full" id="navbar">
        <div class="flex items-center gap-4 group hover-trigger cursor-pointer" data-cursor="magnetic" onclick="window.location.href='index.html'">
          <a href="index.html" class="flex items-center gap-3" onclick="event.preventDefault();">
            <img src="assets/logo/mainLogo.svg" class="w-10 h-10 sm:w-12 sm:h-12 object-contain group-hover:scale-110 group-hover:rotate-12 transition-all duration-500 ease-out" style="filter:brightness(0);">
            <span class="font-doto text-2xl sm:text-3xl font-bold tracking-wider text-black opacity-90 transition-opacity">medi<span class="font-black">Crisis</span></span>
          </a>
        </div>
        
        <div class="hidden md:flex items-center gap-1 p-1.5 bg-black/5 rounded-full border border-black/5 shadow-inner">
          <a href="index.html" class="nav-link ${isHome ? 'active' : ''} relative px-4 sm:px-5 py-2 text-[10px] sm:text-xs uppercase tracking-widest font-bold text-black/60 hover:text-white transition-colors group overflow-hidden rounded-full hover-trigger font-doto">
            <span class="relative z-10">Home</span>
            <div class="absolute inset-0 bg-black translate-y-[100%] group-hover:translate-y-0 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] rounded-full"></div>
          </a>
          <a href="team.html" class="nav-link ${isTeam ? 'active' : ''} relative px-4 sm:px-5 py-2 text-[10px] sm:text-xs uppercase tracking-widest font-bold text-black/60 hover:text-white transition-colors group overflow-hidden rounded-full hover-trigger font-doto">
            <span class="relative z-10">The Team</span>
            <div class="absolute inset-0 bg-black translate-y-[100%] group-hover:translate-y-0 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] rounded-full"></div>
          </a>
          <a href="leaderboard.html" class="nav-link ${isLeaderboard ? 'active' : ''} relative px-4 sm:px-5 py-2 text-[10px] sm:text-xs uppercase tracking-widest font-bold text-black/60 hover:text-white transition-colors group overflow-hidden rounded-full hover-trigger font-doto">
            <span class="relative z-10">Leaderboard</span>
            <div class="absolute inset-0 bg-black translate-y-[100%] group-hover:translate-y-0 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] rounded-full"></div>
          </a>
          <a href="admin.html" class="nav-link ${isAdmin ? 'active' : ''} relative px-4 sm:px-5 py-2 text-[10px] sm:text-xs uppercase tracking-widest font-bold text-black/60 hover:text-white transition-colors group overflow-hidden rounded-full hover-trigger font-doto">
            <span class="relative z-10"><i class="fa-solid fa-lock mr-1 text-[0.5rem]"></i>Admin</span>
            <div class="absolute inset-0 bg-black translate-y-[100%] group-hover:translate-y-0 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] rounded-full"></div>
          </a>
        </div>
        
        <div class="flex items-center gap-3">
          ${rightContent}
        </div>
      </nav>
    `;
    
    // Re-bind hover events for custom cursor if it exists
    if(typeof window.bindHoverEvents === 'function') {
      window.bindHoverEvents(this);
    } else {
      // Fallback binding
      this.querySelectorAll('.hover-trigger, .magnetic-btn, a').forEach(el => {
        el.addEventListener('mouseenter', () => document.body.classList.add('hover-active'));
        el.addEventListener('mouseleave', () => document.body.classList.remove('hover-active'));
      });
      
      this.querySelectorAll('.magnetic-btn').forEach(btn => {
        btn.addEventListener('mousemove', e => {
          const r = btn.getBoundingClientRect();
          if(window.gsap) {
            gsap.to(btn, {x: (e.clientX - r.left - r.width/2)*0.4, y: (e.clientY - r.top - r.height/2)*0.4, duration: 0.4, ease: 'power3.out'});
          }
        });
        btn.addEventListener('mouseleave', () => {
          if(window.gsap) {
            gsap.to(btn, {x: 0, y: 0, duration: 0.8, ease: 'elastic.out(1,0.3)'});
          }
        });
      });
    }
  }
}

customElements.define('medicrisis-navbar', MedicrisisNavbar);
