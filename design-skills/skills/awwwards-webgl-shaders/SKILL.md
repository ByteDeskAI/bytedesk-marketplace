---
name: awwwards-webgl-shaders
description: Advanced WebGL, Three.js, and GLSL shader skill. Guides the agent in setting up interactive web canvases, DOM texture mapping, liquid distortion, and render loop optimizations.
---

# awwwards-webgl-shaders: WebGL, Three.js & GLSL Shaders

This skill guides you in integrating premium WebGL graphics and interactive GLSL shaders into HTML layouts. It covers setting up Three.js scenes, texture projection, hover distortions, and canvas-to-DOM mapping.

---

## 1. WEBGL CANVAS & DOM INTEGRATION

To keep layouts accessible and searchable, **never** build the site entirely in WebGL.
*   **Layered Architecture:** Render normal HTML/CSS elements in the DOM. Place the `<canvas>` on a fixed, full-viewport background:
    ```css
    canvas#webgl-canvas {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none; /* Let HTML capture mouse events */
      z-index: -1; /* Place behind or use positive z-index + pointer-events: none */
    }
    ```

### 1.A DOM Elements to WebGL Mesh Projection
To apply a shader effect (e.g., hover ripple, liquid bend) to an image in the DOM, map its dimensions to a 3D Plane Mesh in Three.js:

```javascript
// Get DOM element dimensions
const bounds = domImage.getBoundingClientRect();

// Map bounds to Three.js Plane geometry
const geometry = new THREE.PlaneGeometry(bounds.width, bounds.height);

// Track position relative to viewport
const mesh = new THREE.Mesh(geometry, shaderMaterial);
mesh.position.x = bounds.left - window.innerWidth / 2 + bounds.width / 2;
mesh.position.y = -bounds.top + window.innerHeight / 2 - bounds.height / 2;
scene.add(mesh);
```

On window resize and scroll events, update the mesh positions and scale dynamically:
```javascript
function updateMeshPositions() {
  const bounds = domImage.getBoundingClientRect();
  mesh.position.x = bounds.left - window.innerWidth / 2 + bounds.width / 2;
  mesh.position.y = -bounds.top + window.innerHeight / 2 - bounds.height / 2;
}
```

---

## 2. SHADER TEMPLATE (Liquid Hover & Wave Distortion)

Utilize GLSL vertex and fragment shaders for creative image distortions. Pass mouse position (`uMouse`), time (`uTime`), scroll momentum (`uScroll`), and hover state (`uProgress`) as uniforms.

### 2.A Vertex Shader (Wave & Bend Calculation)
```glsl
uniform float uTime;
uniform float uScroll;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec3 pos = position;

  // Add scroll wave bending
  pos.y += sin(uv.x * 3.1415) * uScroll * 0.05;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
```

### 2.B Fragment Shader (Liquid Displace & Texture Mapping)
```glsl
uniform sampler2D uTexture;
uniform vec2 uMouse;
uniform float uProgress; // 0.0 to 1.0 (hover state transition)
uniform float uTime;
varying vec2 vUv;

// Simple 2D Pseudo-noise function
float noise(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.7892, 78.233))) * 43758.5453123);
}

void main() {
  vec2 uv = vUv;

  // Create liquid displacement offset based on noise and hover progress
  float distortion = noise(uv * 10.0 + uTime * 0.5) * 0.1 * uProgress;

  // Warp UVs
  uv.x += distortion;
  uv.y += distortion;

  vec4 color = texture2D(uTexture, uv);
  gl_FragColor = color;
}
```

---

## 3. THREE.JS RENDER LOOP OPTIMIZATION

Heavy rendering ruins Awwwards status. Strictly enforce these optimizations:

### 3.A Renderer Configuration
Always configure the `WebGLRenderer` with power preference parameters and cap pixel ratio at 2 (higher values like 3 on Apple Retina screens degrade GPU performance with no visible benefits):

```javascript
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('webgl-canvas'),
  alpha: true,
  antialias: true,
  powerPreference: "high-performance",
});

// Cap pixel ratio
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
```

### 3.B Visibility Culling (Intersection Observer)
Do not waste GPU cycles rendering scenes that are out of the viewport. Use `Intersection Observer` to pause/resume the requestAnimationFrame loop:

```javascript
let isVisible = false;

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    isVisible = entry.isIntersecting;
  });
});

observer.observe(document.querySelector('.webgl-section'));

function tick(time) {
  if (!isVisible) {
    requestAnimationFrame(tick);
    return;
  }

  // Update uniforms
  material.uniforms.uTime.value = time * 0.001;

  // Render
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
```

### 3.C Asset Cleaning (Disposing Geometries/Materials)
To prevent memory leaks when elements are removed or route changes occur:
```javascript
function disposeNode(node) {
  if (node.geometry) node.geometry.dispose();
  if (node.material) {
    if (Array.isArray(node.material)) {
      node.material.forEach(material => material.dispose());
    } else {
      node.material.dispose();
    }
  }
}
```
Ensure this cleanup is executed on page destroy or route transition triggers.
