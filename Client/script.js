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
