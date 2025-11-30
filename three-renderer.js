// Three.js 3D Renderer for iPhone mockups

let threeRenderer = null;
let threeScene = null;
let threeCamera = null;
let phoneModel = null;
let screenMesh = null;
let customScreenPlane = null;
let orbitControls = null;
let isThreeJSInitialized = false;
let phoneModelLoaded = false;

// Screen texture for the screenshot
let screenTexture = null;

// Store original model scale
let baseModelScale = 1;

// Initialize Three.js scene
function initThreeJS() {
    if (isThreeJSInitialized) return;

    const container = document.getElementById('threejs-container');
    if (!container) return;

    // Create scene with a gradient background color (we'll update this dynamically)
    threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0x667eea); // Default gradient start color

    // Create camera
    const aspect = 400 / 700;
    threeCamera = new THREE.PerspectiveCamera(35, aspect, 0.1, 1000);
    threeCamera.position.set(0, 0, 6);

    // Create renderer
    threeRenderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
    });
    threeRenderer.setSize(400, 700);
    threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    threeRenderer.outputEncoding = THREE.sRGBEncoding;
    threeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    threeRenderer.toneMappingExposure = 1.2;

    container.appendChild(threeRenderer.domElement);

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    threeScene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
    keyLight.position.set(2, 3, 4);
    threeScene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-2, 1, 2);
    threeScene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
    rimLight.position.set(0, -2, -3);
    threeScene.add(rimLight);

    // Add orbit controls
    orbitControls = new THREE.OrbitControls(threeCamera, threeRenderer.domElement);
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.05;
    orbitControls.enableZoom = false;
    orbitControls.enablePan = false;
    orbitControls.rotateSpeed = 0.5;

    // Limit rotation
    orbitControls.minPolarAngle = Math.PI / 4;
    orbitControls.maxPolarAngle = Math.PI * 3 / 4;
    orbitControls.minAzimuthAngle = -Math.PI / 3;
    orbitControls.maxAzimuthAngle = Math.PI / 3;

    isThreeJSInitialized = true;

    // Load the phone model
    loadPhoneModel();

    // Start animation loop
    animateThreeJS();
}

// Load the iPhone 3D model
function loadPhoneModel() {
    const loader = new THREE.GLTFLoader();

    loader.load(
        'models/iphone-15-pro-max.glb',
        (gltf) => {
            phoneModel = gltf.scene;

            // Center and scale the model
            const box = new THREE.Box3().setFromObject(phoneModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            // Center the model
            phoneModel.position.sub(center);

            // Scale to fit view
            const maxDim = Math.max(size.x, size.y, size.z);
            baseModelScale = 2.5 / maxDim;
            phoneModel.scale.setScalar(baseModelScale);

            // Log all meshes to help identify the screen
            console.log('Phone model meshes:');
            let blackMeshes = [];
            phoneModel.traverse((child) => {
                if (child.isMesh) {
                    console.log('  Mesh:', child.name, '| Material:', child.material?.name);

                    // Look for screen mesh - in this model it's likely "black" material
                    const name = (child.name || '').toLowerCase();
                    const matName = (child.material?.name || '').toLowerCase();

                    if (matName === 'black') {
                        blackMeshes.push(child);
                    }

                    if (name.includes('screen') || name.includes('display') ||
                        matName.includes('screen') || matName.includes('display') ||
                        matName.includes('emission') || matName.includes('emissive')) {
                        screenMesh = child;
                        console.log('  -> Identified as screen mesh');
                    }
                }
            });

            // Find the front glass - that's where the screen actually is
            // Don't use black meshes, those are small elements like notch/dynamic island
            let glassMeshes = [];
            phoneModel.traverse((child) => {
                if (child.isMesh) {
                    const matName = (child.material?.name || '').toLowerCase();
                    if (matName === 'glass') {
                        child.geometry.computeBoundingBox();
                        const box = child.geometry.boundingBox;
                        const size = new THREE.Vector3();
                        box.getSize(size);
                        const area = size.x * size.y;
                        glassMeshes.push({ mesh: child, area, size });
                        console.log('  Glass mesh:', child.name, 'size:', size.x.toFixed(3), 'x', size.y.toFixed(3), 'area:', area.toFixed(3));
                    }
                }
            });

            // Use the largest glass mesh (front screen glass)
            if (glassMeshes.length > 0) {
                glassMeshes.sort((a, b) => b.area - a.area);
                screenMesh = glassMeshes[0].mesh;
                console.log('  -> Using largest glass mesh as screen:', screenMesh.name);
            }

            // Create a custom screen plane overlay since the model's UV mapping may be incorrect
            createScreenOverlay();

            threeScene.add(phoneModel);
            phoneModelLoaded = true;

            // Apply initial settings from state
            if (typeof state !== 'undefined') {
                updateThreeJSBackground();
                setThreeJSRotation(state.rotation3D.x, state.rotation3D.y, state.rotation3D.z);
                setThreeJSScale(state.scale3D);

                // Apply screenshot texture
                if (state.screenshots.length > 0) {
                    updateScreenTexture();
                }

                // Refresh canvas now that model is loaded
                if (state.use3D && typeof updateCanvas === 'function') {
                    updateCanvas();
                }
            }

            console.log('Phone model loaded successfully');
        },
        (progress) => {
            const percent = Math.round(progress.loaded / progress.total * 100);
            console.log('Loading phone model... ' + percent + '%');
        },
        (error) => {
            console.error('Error loading phone model:', error);
        }
    );
}

// Create a custom screen plane overlay with correct UV mapping
function createScreenOverlay() {
    if (customScreenPlane) {
        if (customScreenPlane.parent) {
            customScreenPlane.parent.remove(customScreenPlane);
        }
        customScreenPlane.geometry.dispose();
        customScreenPlane.material.dispose();
    }

    // iPhone 15 Pro Max aspect ratio is 1290/2796
    const aspectRatio = 1290 / 2796;

    // Use fixed dimensions - slightly smaller to fit within bezels
    const planeHeight = 4.3 * 0.82; // 82% of phone height for screen area
    const planeWidth = planeHeight * aspectRatio;

    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const material = new THREE.MeshBasicMaterial({
        color: 0x111111,
        side: THREE.DoubleSide
    });

    customScreenPlane = new THREE.Mesh(geometry, material);

    // Position at center of phone, slightly in front of glass
    customScreenPlane.position.set(0.025, 0.745, 0.0959); // slight Y offset to center in screen area

    // Add directly to phoneModel so it rotates with it
    phoneModel.add(customScreenPlane);

    console.log('Created screen overlay at:', customScreenPlane.position);
    console.log('Plane size:', planeWidth.toFixed(4), 'x', planeHeight.toFixed(4));
}

// Create a rounded corner version of the screenshot
function createRoundedScreenImage(image, cornerRadius) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');

    // Draw rounded rectangle path
    const w = canvas.width;
    const h = canvas.height;
    const r = cornerRadius;

    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.quadraticCurveTo(w, 0, w, r);
    ctx.lineTo(w, h - r);
    ctx.quadraticCurveTo(w, h, w - r, h);
    ctx.lineTo(r, h);
    ctx.quadraticCurveTo(0, h, 0, h - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();

    // Clip to rounded rectangle and draw image
    ctx.clip();
    ctx.drawImage(image, 0, 0);

    return canvas;
}

// Update the screen texture with current screenshot
function updateScreenTexture() {
    if (!phoneModel) return;
    if (typeof state === 'undefined' || !state.screenshots.length) return;

    const screenshot = state.screenshots[state.selectedIndex];
    if (!screenshot || !screenshot.image) return;

    // Create texture from screenshot
    if (screenTexture) {
        screenTexture.dispose();
    }

    // Create rounded corner version of the image
    // iPhone 15 Pro Max has ~55px corner radius on 1290px width screen (~4.3%)
    // But the physical device corners are larger, around 6-7%
    const cornerRadius = Math.round(screenshot.image.width * 0.15);
    const roundedImage = createRoundedScreenImage(screenshot.image, cornerRadius);

    screenTexture = new THREE.Texture(roundedImage);
    screenTexture.needsUpdate = true;
    screenTexture.encoding = THREE.sRGBEncoding;
    screenTexture.flipY = true;

    // Create a material for the screen with transparency for rounded corners
    const screenMaterial = new THREE.MeshBasicMaterial({
        map: screenTexture,
        side: THREE.FrontSide,
        transparent: true
    });

    // Apply to custom screen plane (preferred)
    if (customScreenPlane) {
        customScreenPlane.material.dispose();
        customScreenPlane.material = screenMaterial;
        console.log('Applied rounded texture to custom screen plane');
    }
}

// Set 3D rotation from sliders (in degrees)
function setThreeJSRotation(rotX, rotY, rotZ) {
    if (!phoneModel) return;

    phoneModel.rotation.x = rotX * Math.PI / 180;
    phoneModel.rotation.y = rotY * Math.PI / 180;
    phoneModel.rotation.z = rotZ * Math.PI / 180;
}

// Set 3D scale
function setThreeJSScale(scale) {
    if (!phoneModel) return;

    phoneModel.scale.setScalar(baseModelScale * (scale / 100));
}

// Animation loop
function animateThreeJS() {
    requestAnimationFrame(animateThreeJS);

    if (orbitControls) {
        orbitControls.update();
    }

    if (threeRenderer && threeScene && threeCamera) {
        threeRenderer.render(threeScene, threeCamera);
    }
}

// Render 3D phone only (with transparent background) to be composited
function renderThreeJSToCanvas(targetCanvas, width, height) {
    if (!threeRenderer || !threeScene || !threeCamera || !phoneModel) return;

    const dims = { width: width || 1290, height: height || 2796 };

    // Store original values
    const originalBackground = threeScene.background;
    const originalPosition = phoneModel.position.clone();
    const originalScale = phoneModel.scale.clone();

    // Apply position from state.screenshot settings
    if (typeof state !== 'undefined') {
        // Scale: use screenshot.scale to adjust model size (combined with scale3D)
        const screenshotScale = state.screenshot.scale / 100;
        const scale3D = state.scale3D / 100;
        phoneModel.scale.setScalar(baseModelScale * scale3D * screenshotScale);

        // Position: convert percentage to 3D space offset
        // X: 0% = left, 50% = center, 100% = right
        // Y: 0% = top, 50% = center, 100% = bottom
        const xOffset = ((state.screenshot.x - 50) / 50) * 2; // -2 to 2 range
        const yOffset = -((state.screenshot.y - 50) / 50) * 3; // -3 to 3 range (inverted for 3D)
        phoneModel.position.set(xOffset, yOffset, 0);
    }

    // Set transparent background for compositing
    threeScene.background = null;

    // Temporarily resize renderer
    const oldSize = { width: 400, height: 700 };
    threeRenderer.setSize(dims.width, dims.height);
    threeCamera.aspect = dims.width / dims.height;
    threeCamera.updateProjectionMatrix();

    // Render with transparency
    threeRenderer.render(threeScene, threeCamera);

    // Draw to target canvas (compositing the 3D phone onto existing content)
    const ctx = targetCanvas.getContext('2d');
    ctx.drawImage(threeRenderer.domElement, 0, 0, dims.width, dims.height);

    // Restore size, background, and model transforms
    threeRenderer.setSize(oldSize.width, oldSize.height);
    threeCamera.aspect = oldSize.width / oldSize.height;
    threeCamera.updateProjectionMatrix();
    threeScene.background = originalBackground;
    phoneModel.position.copy(originalPosition);
    phoneModel.scale.copy(originalScale);
}

// Show/hide Three.js container
function showThreeJS(show) {
    const container = document.getElementById('threejs-container');
    const canvas = document.getElementById('preview-canvas');

    // In 3D mode, we show the 2D canvas (which composites everything)
    // The Three.js container is hidden but used for rendering
    if (container) {
        container.style.display = 'none'; // Always hidden - we render to 2D canvas
    }
    if (canvas) {
        canvas.style.display = 'block'; // Always visible
    }

    if (show && !isThreeJSInitialized) {
        initThreeJS();
    }

    // Apply current rotation, scale, background
    if (show && typeof state !== 'undefined') {
        updateThreeJSBackground();
        if (phoneModel) {
            setThreeJSRotation(state.rotation3D.x, state.rotation3D.y, state.rotation3D.z);
            setThreeJSScale(state.scale3D);
            updateScreenTexture();
        }
    }
}

// Get Three.js canvas for export
function getThreeJSCanvas() {
    return threeRenderer ? threeRenderer.domElement : null;
}

// Update Three.js scene background from state
function updateThreeJSBackground() {
    if (!threeScene || typeof state === 'undefined') return;

    if (state.background.type === 'solid') {
        threeScene.background = new THREE.Color(state.background.solid);
    } else if (state.background.type === 'gradient') {
        // Use the first gradient color as background (Three.js doesn't support gradients natively)
        const firstStop = state.background.gradient.stops[0];
        if (firstStop) {
            threeScene.background = new THREE.Color(firstStop.color);
        }
    } else {
        // For image backgrounds, use a neutral color
        threeScene.background = new THREE.Color(0x1a1a2e);
    }
}

// Cleanup
function disposeThreeJS() {
    if (screenTexture) {
        screenTexture.dispose();
    }
    if (threeRenderer) {
        threeRenderer.dispose();
    }
    isThreeJSInitialized = false;
    phoneModelLoaded = false;
}

// Interactive rotation for 2D canvas in 3D mode
let isDragging3D = false;
let lastMouseX = 0;
let lastMouseY = 0;

// Helper to update rotation and sync UI
function update3DRotation(deltaX, deltaY) {
    if (typeof state === 'undefined' || !state.use3D) return;

    // Update rotation based on movement
    state.rotation3D.y = Math.max(-45, Math.min(45, state.rotation3D.y + deltaX * 0.5));
    state.rotation3D.x = Math.max(-45, Math.min(45, state.rotation3D.x + deltaY * 0.5));

    // Update desktop sliders
    const rotYSlider = document.getElementById('rotation-3d-y');
    const rotYValue = document.getElementById('rotation-3d-y-value');
    const rotXSlider = document.getElementById('rotation-3d-x');
    const rotXValue = document.getElementById('rotation-3d-x-value');

    if (rotYSlider) rotYSlider.value = state.rotation3D.y;
    if (rotYValue) rotYValue.textContent = Math.round(state.rotation3D.y) + '°';
    if (rotXSlider) rotXSlider.value = state.rotation3D.x;
    if (rotXValue) rotXValue.textContent = Math.round(state.rotation3D.x) + '°';

    // Update mobile sliders
    const mobileRotYSlider = document.getElementById('mobile-rotation-3d-y');
    const mobileRotYValue = document.getElementById('mobile-rotation-3d-y-value');
    const mobileRotXSlider = document.getElementById('mobile-rotation-3d-x');
    const mobileRotXValue = document.getElementById('mobile-rotation-3d-x-value');

    if (mobileRotYSlider) mobileRotYSlider.value = state.rotation3D.y;
    if (mobileRotYValue) mobileRotYValue.textContent = Math.round(state.rotation3D.y) + '°';
    if (mobileRotXSlider) mobileRotXSlider.value = state.rotation3D.x;
    if (mobileRotXValue) mobileRotXValue.textContent = Math.round(state.rotation3D.x) + '°';

    // Apply rotation
    setThreeJSRotation(state.rotation3D.x, state.rotation3D.y, state.rotation3D.z);

    // Update canvas
    if (typeof updateCanvas === 'function') {
        updateCanvas();
    }
}

function setup3DCanvasInteraction() {
    const canvas = document.getElementById('preview-canvas');
    if (!canvas) return;

    // Mouse events for desktop
    canvas.addEventListener('mousedown', (e) => {
        if (typeof state !== 'undefined' && state.use3D) {
            isDragging3D = true;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            canvas.style.cursor = 'grabbing';
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!isDragging3D || typeof state === 'undefined' || !state.use3D) return;

        const deltaX = e.clientX - lastMouseX;
        const deltaY = e.clientY - lastMouseY;

        update3DRotation(deltaX, deltaY);

        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    });

    canvas.addEventListener('mouseup', () => {
        if (isDragging3D) {
            isDragging3D = false;
            canvas.style.cursor = '';
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (isDragging3D) {
            isDragging3D = false;
            canvas.style.cursor = '';
        }
    });

    // Change cursor when hovering in 3D mode
    canvas.addEventListener('mouseenter', () => {
        if (typeof state !== 'undefined' && state.use3D) {
            canvas.style.cursor = 'grab';
        }
    });

    // Touch events for mobile
    canvas.addEventListener('touchstart', (e) => {
        if (typeof state !== 'undefined' && state.use3D && e.touches.length === 1) {
            isDragging3D = true;
            lastMouseX = e.touches[0].clientX;
            lastMouseY = e.touches[0].clientY;
            // Don't prevent default here - let the touch be recognized
        }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
        if (!isDragging3D || typeof state === 'undefined' || !state.use3D) return;
        if (e.touches.length !== 1) return;

        const touch = e.touches[0];
        const deltaX = touch.clientX - lastMouseX;
        const deltaY = touch.clientY - lastMouseY;

        // Only process if there's significant movement (prevents jitter)
        if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
            e.preventDefault(); // Prevent scrolling when rotating
            update3DRotation(deltaX, deltaY);
            lastMouseX = touch.clientX;
            lastMouseY = touch.clientY;
        }
    }, { passive: false });

    canvas.addEventListener('touchend', () => {
        isDragging3D = false;
    }, { passive: true });

    canvas.addEventListener('touchcancel', () => {
        isDragging3D = false;
    }, { passive: true });
}

// Initialize interaction when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup3DCanvasInteraction);
} else {
    setup3DCanvasInteraction();
}
