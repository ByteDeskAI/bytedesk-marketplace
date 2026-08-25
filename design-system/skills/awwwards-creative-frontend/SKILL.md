---
name: awwwards-creative-frontend
description: General creative coding skill. Focuses on premium layouts, typography, grids, GSAP timelines, ScrollTrigger setup, and Lenis smooth scrolling.
---

# awwwards-creative-frontend: Core Layout, Motion & Scroll

This skill guides you to build high-end editorial and marketing layouts. It enforces typography, spacing, grid dynamics, GSAP, and smooth scroll setups, ensuring that you do not default to standard AI layout slop.

---

## 0. BRIEF ANALYSIS & CONFIGURATION

Before generating any code, run a design audit on the user's prompt. Declare a single-line "Design Read" at the beginning of your response:
**"Design Read: <page kind> for <audience>, vibe is <vibe language>, style is <aesthetic direction>. Dials: Variance: X, Motion: Y, Density: Z."**

### Dials (Global Configuration Variables):
*   **`DESIGN_VARIANCE` (1-10):** (Default: 8). 1 = Perfect symmetry / standard SaaS grid; 10 = Artsy, asymmetric, overlapping, and chaotic grids (agency/editorial style).
*   **`MOTION_INTENSITY` (1-10):** (Default: 8). 1 = Static / CSS-only transitions; 10 = Cinematic, physics-based scroll triggers, staggered text reveals, WebGL interactions.
*   **`VISUAL_DENSITY` (1-10):** (Default: 3). 1 = Airy gallery / high-end fashion / minimal portfolio; 10 = Packed data panel / cockpit UI.

---

## 1. TYPOGRAPHY & SPACING DISCIPLINE

### 1.A Anti-Default Typography
*   **Display/Headlines:** Default to `tracking-tighter leading-none`. Never default to `Inter` or `Roboto` for display headers. Instead, reach for premium sans-serif display fonts (e.g., `Geist Display`, `PP Neue Montreal`, `Cabinet Grotesk`) or high-end display serifs (e.g., `PP Editorial New`, `Tiempos Headline`) if explicitly requested by the brand identity.
*   **Italic Descender Clearance:** When using italic display type, ensure it has descender clearance to prevent clipping (`g j p q y`). Never use `leading-none` or `leading-[1]` on italic display blocks without setting at least `leading-[1.1]` or adding bottom padding reserve.
*   **No Mixed-Family Emphasis:** When emphasizing words in headlines, do NOT swap font families (e.g., placing a serif word inside a sans headline). Use the *italic* or **bold** version of the **same** font.

### 1.B Spacing & Layout Rules
*   **Viewport Stability:** Never use `h-screen` for hero sections. Always use `min-h-[100dvh]` to prevent viewport jumping on mobile devices due to address bars.
*   **Hero Stack & Top Padding:**
    *   Top padding on hero sections must not exceed `pt-24` (≈6rem) on desktop.
    *   Hero section must contain a maximum of 4 elements (Eyebrow or brand strip, Headline [max 2 lines], Subtext [max 20 words], CTAs [1 primary + max 1 secondary]).
    *   No taglines, pricing teasers, or social proof logos inside the hero block. They belong in dedicated sections below.
*   **Asymmetric Grids (Bento & Lists):**
    *   Avoid repetitive grid configurations. Alternating left-image/right-text rows (zigzag) is limited to a maximum of 2 consecutive sections. The third section must break this rhythm.
    *   Bento cells must not be empty. Every bento box must contain actual content, mock-free illustrations, or high-quality assets. Ensure at least 30% of cells have visual assets (real images/patterns) instead of text-only layouts.
*   **Section Layout Diversity:** A single page with multiple sections must not repeat the same layout format. If a 3-column card grid is used for "Projects," it cannot be used for "Services." Use tabs, sliders, marquees, or accordions to diversify.

---

## 2. SMOOTH SCROLLING (Lenis Setup)

Premium sites rely on smooth momentum scrolling. Use **Lenis** as the standard scroll library.

### 2.A Initializer Script (Vanilla JS / Next.js)
Integrate Lenis on the root element and tie it to the browser's requestAnimationFrame (RAF) loop:

```javascript
import Lenis from '@studio-freight/lenis';

const lenis = new Lenis({
  duration: 1.2,
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // Custom exponential ease
  orientation: 'vertical',
  gestureOrientation: 'vertical',
  smoothWheel: true,
  wheelMultiplier: 1,
  touchMultiplier: 2,
  infinite: false,
});

function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}

requestAnimationFrame(raf);
```

### 2.B Lifecycle Controls
*   Stop scrolling during loading states, modals, or page transitions using `lenis.stop()`.
*   Resume scrolling immediately after using `lenis.start()`.

---

## 3. TIMELINES & SCROLL-DRIVEN MOTION (GSAP & ScrollTrigger)

When `MOTION_INTENSITY > 4`, use **GSAP** (GreenSock Animation Platform) and **ScrollTrigger** for animations.

### 3.A ScrollTrigger Synchronization
Ensure GSAP is aware of Lenis scroll position by syncing them:

```javascript
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Update ScrollTrigger on Lenis scroll
lenis.on('scroll', ScrollTrigger.update);

// Tell ScrollTrigger to use Lenis for proxying scroll events if using custom container scroll
ScrollTrigger.defaults({
  toggleActions: "play none none reverse",
  markers: false
});
```

### 3.B Creative Animation Guidelines
*   **Text Splits:** Headlines must be split by characters or lines (e.g., using `split-type` package) and animated using stagger:
    ```javascript
    import SplitType from 'split-type';

    const text = new SplitType('.reveal-text', { types: 'chars,lines' });

    gsap.from(text.chars, {
      scrollTrigger: {
        trigger: '.reveal-text',
        start: 'top 80%',
      },
      y: 100,
      opacity: 0,
      stagger: 0.02,
      duration: 1,
      ease: 'power4.out'
    });
    ```
*   **Parallax Scroll:** Do not use CSS parallax. Use GSAP ScrollTrigger to move elements at different speeds relative to the scroll:
    ```javascript
    gsap.to('.parallax-bg', {
      scrollTrigger: {
        trigger: '.parallax-container',
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
      yPercent: 20,
      ease: 'none',
    });
    ```
*   **Custom Easing:** Never use linear or abrupt easing. Utilize smooth easing functions like `"power3.out"`, `"power4.out"`, or GSAP `CustomEase` to give animations organic weight.

---

## 4. PRE-FLIGHT CHECKLIST FOR CODING AGENT
Before returning any completed code, verify that:
1.  **Mobile viewports** use `min-h-[100dvh]` instead of `h-screen`.
2.  **Navigation bar** takes up a single line on desktop and does not wrap.
3.  **Color consistency** is maintained; all sections use the exact same primary accent tone.
4.  **No duplicate CTA intents** (e.g. having both "Get in Touch" and "Contact Us" on the same page).
5.  **WCAG AA compliance** for contrast on all buttons and form fields is validated.
