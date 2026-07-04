// ── Intro video ────────────────────────────────
(function () {
  const overlay = document.getElementById('intro-overlay');
  if (!overlay) return;

  const INTRO_START_TIME_SECONDS = 6;

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

  function startIntroFromOffset() {
    if (!video) return;

    const canUseDuration = Number.isFinite(video.duration) && video.duration > 0;
    const safeStartTime = canUseDuration
      ? Math.min(INTRO_START_TIME_SECONDS, Math.max(video.duration - 0.05, 0))
      : INTRO_START_TIME_SECONDS;

    try {
      video.currentTime = safeStartTime;
    } catch (_error) {
      // Some browsers can reject seeking before enough data has loaded.
    }

    video.play().catch(() => {
      // Ignore autoplay failures; user can still skip or interact.
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
