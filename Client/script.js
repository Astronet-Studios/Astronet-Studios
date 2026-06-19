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
