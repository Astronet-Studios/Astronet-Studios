(function () {
  const overlay = document.getElementById('intro-overlay');
  if (!overlay) return;

  const INTRO_START_TIME_SECONDS = 5.7;

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

  function startIntroFromOffset() {
    if (!video) return;

    const canUseDuration = Number.isFinite(video.duration) && video.duration > 0;
    const safeStartTime = canUseDuration
      ? Math.min(INTRO_START_TIME_SECONDS, Math.max(video.duration - 0.05, 0))
      : INTRO_START_TIME_SECONDS;

    try {
      video.currentTime = safeStartTime;
    } catch (_error) {
    }

    video.play().catch(() => {
    });
  }

  video.addEventListener('ended', dismiss);
  skipBtn.addEventListener('click', dismiss);

  if (video.readyState >= 1) {
    startIntroFromOffset();
  } else {
    video.addEventListener('loadedmetadata', startIntroFromOffset, { once: true });
  }
})();

const COOKIE_CONSENT_KEY = 'astronetCookieConsent';
const ANALYTICS_ID = 'G-ZKLVW291RR';

function getStoredConsent() {
  try {
    return localStorage.getItem(COOKIE_CONSENT_KEY);
  } catch (_error) {
    return null;
  }
}

function setStoredConsent(decision) {
  try {
    localStorage.setItem(COOKIE_CONSENT_KEY, decision);
  } catch (_error) {
  }
}

function loadAnalytics() {
  if (window.__astronetAnalyticsLoaded) {
    return;
  }

  window.__astronetAnalyticsLoaded = true;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${ANALYTICS_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', ANALYTICS_ID);
}

function applyCookieConsent(decision) {
  setStoredConsent(decision);

  if (decision === 'accepted') {
    loadAnalytics();
  }
}

function createCookieBanner() {
  const savedConsent = getStoredConsent();
  if (savedConsent === 'accepted') {
    loadAnalytics();
    return;
  }

  if (savedConsent === 'declined') {
    return;
  }

  const banner = document.createElement('section');
  banner.className = 'cookie-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-live', 'polite');
  banner.innerHTML = `
    <div class="cookie-banner-copy">
      <p class="cookie-banner-title">Privacy choice</p>
      <p>We use analytics cookies to understand site traffic and improve the experience. Accept or decline to continue.</p>
    </div>
    <div class="cookie-banner-actions">
      <button type="button" class="btn btn-secondary btn-small cookie-decline">Decline</button>
      <button type="button" class="btn btn-primary btn-small cookie-accept">Accept</button>
    </div>
  `;

  document.body.appendChild(banner);

  banner.querySelector('.cookie-accept').addEventListener('click', () => {
    applyCookieConsent('accepted');
    banner.remove();
  });

  banner.querySelector('.cookie-decline').addEventListener('click', () => {
    applyCookieConsent('declined');
    banner.remove();
  });
}

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

const contactPageForm = document.getElementById('contact-page-form');
const contactPageMessage = document.getElementById('contact-form-message');

if (contactPageForm && contactPageMessage) {
  contactPageForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = Object.fromEntries(new FormData(contactPageForm).entries());
    contactPageMessage.classList.remove('is-error', 'is-success');
    contactPageMessage.textContent = 'Sending your message...';

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Unable to send your message right now.');
      }

      contactPageForm.reset();
      contactPageMessage.classList.add('is-success');
      contactPageMessage.textContent = data.message || 'Thanks. Your message has been sent.';
    } catch (error) {
      contactPageMessage.classList.add('is-error');
      contactPageMessage.textContent = error.message;
    }
  });
}

function enhanceLongCopyBlocks() {
  const paragraphs = document.querySelectorAll('main p.hero-copy');

  paragraphs.forEach((paragraph) => {
    if (paragraph.dataset.copyEnhanced === 'true') {
      return;
    }

    if (paragraph.querySelector('*')) {
      return;
    }

    const rawText = paragraph.textContent.replace(/\s+/g, ' ').trim();
    if (rawText.length < 240) {
      return;
    }

    const sentences = rawText
      .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean);

    if (!sentences || sentences.length < 3) {
      return;
    }

    paragraph.textContent = '';
    paragraph.classList.add('copy-refined');
    paragraph.dataset.copyEnhanced = 'true';

    for (let index = 0; index < sentences.length; index += 2) {
      const chunk = sentences.slice(index, index + 2).join(' ');
      const chunkNode = document.createElement('span');
      chunkNode.className = 'copy-chunk';
      chunkNode.textContent = chunk;
      paragraph.appendChild(chunkNode);
    }
  });
}

enhanceLongCopyBlocks();
createCookieBanner();

// ── Shooting star on load ───────────────────────────────────
(function fireShootingStar() {
  const container = document.querySelector('.starfield');
  if (!container) return;

  // Start upper-right, shoot toward lower-left
  const startX = 70 + Math.random() * 20; // 70–90% from left
  const startY = 5  + Math.random() * 12; // 5–17% from top

  const star = document.createElement('div');
  star.setAttribute('aria-hidden', 'true');
  star.style.cssText =
    'position:absolute;' +
    'left:' + startX + '%;' +
    'top:'  + startY  + '%;' +
    'width:260px;height:3px;' +
    'border-radius:999px;' +
    // Head (bright) on LEFT — direction of travel; tail fades to the right
    'background:linear-gradient(to right,#fff 0%,rgba(200,230,255,0.95) 30%,rgba(150,200,255,0.4) 70%,transparent 100%);' +
    'box-shadow:0 0 8px 2px rgba(200,230,255,0.9),0 0 2px 1px #fff;' +
    'pointer-events:none;' +
    'opacity:0;';

  container.appendChild(star);

  // Use setTimeout so the delay is reliable regardless of CSS load order
  setTimeout(function () {
    star.style.animation = 'shooting-star 1s cubic-bezier(0.4,0,1,1) 1 forwards';
    star.addEventListener('animationend', () => star.remove(), { once: true });
  }, 1600);
})();

// ── Twinkling stars ─────────────────────────────────────────────
(function initTwinklingStars() {
  const container = document.querySelector('.starfield');
  if (!container) return;

  const STAR_COUNT = 120;
  const COLORS = [
    'rgba(255,255,255,VAL)',
    'rgba(180,220,255,VAL)',
    'rgba(66,165,245,VAL)',
    'rgba(0,229,255,VAL)',
  ];

  const frag = document.createDocumentFragment();

  for (let i = 0; i < STAR_COUNT; i++) {
    const star = document.createElement('span');
    const size    = (Math.random() * 2 + 0.5).toFixed(2);          // 0.5–2.5 px
    const x       = (Math.random() * 100).toFixed(3);
    const y       = (Math.random() * 100).toFixed(3);
    const dur     = (Math.random() * 5 + 2).toFixed(2);            // 2–7 s
    const delay   = (Math.random() * 8).toFixed(2);                // 0–8 s offset
    const baseOp  = (Math.random() * 0.25 + 0.75).toFixed(2);      // 0.75–1.0
    const color   = COLORS[Math.floor(Math.random() * COLORS.length)].replace('VAL', baseOp);

    star.style.cssText =
      'position:absolute;' +
      'left:' + x + '%;' +
      'top:'  + y + '%;' +
      'width:'  + size + 'px;' +
      'height:' + size + 'px;' +
      'border-radius:50%;' +
      'background:' + color + ';' +
      'animation:star-twinkle ' + dur + 's ease-in-out ' + delay + 's infinite;' +
      'will-change:opacity,transform,filter;';

    frag.appendChild(star);
  }

  document.body.appendChild(layer);
})();

// ── Staggered grid children reveal ─────────────────────────────
(function initStaggerReveal() {
  const grids = document.querySelectorAll(
    '.card-grid, .steps, .portfolio-grid-home, .trust-proof-grid, .value-strip-grid'
  );

  if (!grids.length) return;

  const staggerObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        [...entry.target.children].forEach((child, i) => {
          child.style.transitionDelay = `${0.35 + i * 0.11}s`;
          child.classList.add('child-visible');
        });
        staggerObserver.unobserve(entry.target);
      });
    },
    { threshold: 0.1 }
  );

  grids.forEach((grid) => {
    [...grid.children].forEach((child) => {
      child.classList.add('stagger-child');
    });
    staggerObserver.observe(grid);
  });
})();
