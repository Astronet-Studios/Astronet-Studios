// ── Intro video ────────────────────────────────
(function () {
  const overlay = document.getElementById('intro-overlay');
  if (!overlay) return;

  // Skip intro if already played this session
  if (sessionStorage.getItem('introPlayed')) {
    overlay.remove();
    return;
  }

  const video = document.getElementById('intro-video');
  const skipBtn = document.getElementById('intro-skip');

  function dismiss() {
    sessionStorage.setItem('introPlayed', '1');
    overlay.classList.add('fade-out');
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
  }

  video.addEventListener('ended', dismiss);
  skipBtn.addEventListener('click', dismiss);
})();

const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('.main-nav');

if (menuButton && nav) {
  menuButton.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(isOpen));
  });

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      menuButton.setAttribute('aria-expanded', 'false');
    });
  });
}

const revealItems = document.querySelectorAll('.reveal');

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry, index) => {
      if (!entry.isIntersecting) {
        return;
      }

      entry.target.style.transitionDelay = `${index * 80}ms`;
      entry.target.classList.add('show');
      observer.unobserve(entry.target);
    });
  },
  { threshold: 0.12 }
);

revealItems.forEach((item) => observer.observe(item));

const backToTopButton = document.querySelector('.back-to-top');

if (backToTopButton) {
  const toggleBackToTop = () => {
    backToTopButton.classList.toggle('visible', window.scrollY > 300);
  };

  window.addEventListener('scroll', toggleBackToTop, { passive: true });

  backToTopButton.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  toggleBackToTop();
}
