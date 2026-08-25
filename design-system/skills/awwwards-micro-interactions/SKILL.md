---
name: awwwards-micro-interactions
description: Specialized micro-interactions and transitions skill. Guides the agent in writing custom lag cursors (LERP), magnetic hover buttons, and leak-free page transitions (Barba.js).
---

# awwwards-micro-interactions: Cursors, Physics & Transitions

This skill guides you in implementing premium micro-interactions, fluid hover physics, and seamless page transitions that make websites feel dynamic, tactile, and responsive.

---

## 1. CUSTOM CURSOR WITH LERP (Linear Interpolation)

Standard cursor hiding and mapping can look jagged. Always implement a custom lagging cursor using **Linear Interpolation (LERP)** to create a smooth, viscous follow effect.

### 1.A HTML & CSS Setup
```html
<div class="custom-cursor" id="custom-cursor"></div>
```
```css
.custom-cursor {
  position: fixed;
  top: 0;
  left: 0;
  width: 20px;
  height: 20px;
  background-color: var(--accent-color, #ffffff);
  border-radius: 50%;
  pointer-events: none; /* Crucial: Let click events pass through */
  z-index: 9999;
  will-change: transform; /* Optimize for GPU rendering */
  transform: translate3d(-50%, -50%, 0);
  transition: width 0.3s ease, height 0.3s ease, background-color 0.3s ease;
}
```

### 1.B JavaScript LERP Loop
Track the target mouse coordinate and interpolate the cursor's current coordinate toward it:

```javascript
let mouse = { x: 0, y: 0 };
let cursor = { x: 0, y: 0 };
const cursorElement = document.getElementById('custom-cursor');

window.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

function updateCursor() {
  // LERP formula: current = current + (target - current) * factor
  const lerpFactor = 0.1; // Lower = more lag / smoother; Higher = faster
  cursor.x += (mouse.x - cursor.x) * lerpFactor;
  cursor.y += (mouse.y - cursor.y) * lerpFactor;

  cursorElement.style.transform = `translate3d(${cursor.x}px, ${cursor.y}px, 0) translate(-50%, -50%)`;

  requestAnimationFrame(updateCursor);
}
requestAnimationFrame(updateCursor);
```

### 1.C Interactive Hover States
Expand or change cursor shape when hovering over links (`a`), buttons (`button`), or interactive elements:
```javascript
const hoverElements = document.querySelectorAll('a, button, [data-hover]');

hoverElements.forEach(el => {
  el.addEventListener('mouseenter', () => {
    cursorElement.style.width = '50px';
    cursorElement.style.height = '50px';
    cursorElement.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
  });

  el.addEventListener('mouseleave', () => {
    cursorElement.style.width = '20px';
    cursorElement.style.height = '20px';
    cursorElement.style.backgroundColor = 'var(--accent-color)';
  });
});
```
*   **Viewport Hide:** Ensure the cursor fades out when the mouse leaves the browser window (`document.addEventListener('mouseleave')`).

---

## 2. MAGNETIC BUTTON FEEDBACK

Magnetic buttons feel extremely premium by "pulling" toward the cursor when it gets close.

### 2.A GSAP Implementation (Recommended)
Attach hover event listeners and calculate the distance vector between the button center and the mouse pointer:

```javascript
import gsap from 'gsap';

const magneticBtns = document.querySelectorAll('.magnetic-button');

magneticBtns.forEach(btn => {
  btn.addEventListener('mousemove', (e) => {
    const rect = btn.getBoundingClientRect();
    const btnCenterX = rect.left + rect.width / 2;
    const btnCenterY = rect.top + rect.height / 2;

    // Calculate distance vector
    const xDist = e.clientX - btnCenterX;
    const yDist = e.clientY - btnCenterY;

    // Magnetic pull range limit (e.g. max 30px offset)
    const pullMultiplier = 0.4;

    gsap.to(btn, {
      x: xDist * pullMultiplier,
      y: yDist * pullMultiplier,
      duration: 0.3,
      ease: 'power2.out'
    });
  });

  btn.addEventListener('mouseleave', () => {
    // Return button back to origin smoothly
    gsap.to(btn, {
      x: 0,
      y: 0,
      duration: 0.5,
      ease: 'elastic.out(1, 0.3)' // Tactile springy feel
    });
  });
});
```

---

## 3. BEZIER SEAMLESS PAGE TRANSITIONS (Barba.js)

Page transitions intercept clicks on anchor tags (`a`), query the target HTML via AJAX, hot-swap the wrapper content, and execute transition animations without reloading the tab.

### 3.A Standard Transition Structure (Barba.js v2)
Ensure page containers are defined with `data-barba="wrapper"` and `data-barba="container"`:

```javascript
import barba from '@barba/core';
import gsap from 'gsap';

barba.init({
  transitions: [{
    name: 'bezier-fade',
    async leave(data) {
      // 1. Trigger exit animation
      await new Promise(resolve => {
        gsap.to(data.current.container, {
          opacity: 0,
          y: -30,
          duration: 0.6,
          ease: 'power3.inOut',
          onComplete: resolve
        });
      });
    },
    enter(data) {
      // 2. Clear old scroll state & instances
      window.scrollTo(0, 0);

      // 3. Trigger entrance animation for new content
      gsap.from(data.next.container, {
        opacity: 0,
        y: 30,
        duration: 0.6,
        ease: 'power3.out'
      });
    }
  }]
});
```

### 3.B Crucial Memory Leak Prevention
Whenever pages are replaced, clean up all dynamic events to prevent memory leaks and garbage collection bottlenecks:
1.  **Kill ScrollTriggers:** Call `ScrollTrigger.getAll().forEach(trigger => trigger.kill())` in the `leave()` hook.
2.  **Destroy Slider Instances:** Destroy Swiper sliders or custom carousels using `.destroy()`.
3.  **Reset Lenis Scroll Position:** Call `lenis.scrollTo(0, { immediate: true })` before running the enter animation.
4.  **Re-run Event Initializers:** Re-attach cursor hovers, magnetic buttons, and GSAP reveal timelines to elements on the newly loaded page in the `afterEnter()` hook.
