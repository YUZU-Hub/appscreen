// Three.js 3D Renderer for iPhone mockups

let threeRenderer = null;
let threeScene = null;
let threeCamera = null;
let phoneModel = null;
let phonePivot = null;  // Pivot group for rotation around screen center
let screenMesh = null;
let customScreenPlane = null;
let orbitControls = null;
let isThreeJSInitialized = false;
let phoneModelLoaded = false;
let phoneModelLoading = false;

// Screen texture for the screenshot
let screenTexture = null;

// Store original model scale
let baseModelScale = 1;

// Store base position offset to keep model centered after screen alignment
let basePositionOffset = { x: 0, y: 0, z: 0 };

// Current device model type
let currentDeviceModel = 'iphone';

// Cache for loaded phone models (for rendering different devices in side previews)
let phoneModelCache = {};  // { deviceType: { model, pivot, screenPlane, baseScale, loaded } }

// Device-specific configurations
const deviceConfigs = {
    iphone: {
        modelPath: 'models/iphone-15-pro-max.glb',
        aspectRatio: 1290 / 2796,
        screenHeightFactor: 0.826,
        screenOffset: { x: 0.027, y: 0.745, z: 0.098 },
        positionOffsetFactor: 0.81,
        cornerRadiusFactor: 0.16,
        modelRotation: { x: 0, y: 0, z: 0 }  // No correction needed
    },
    samsung: {
        modelPath: 'models/samsung-galaxy-s25-ultra.glb',
        aspectRatio: 1440 / 3120,
        screenHeightFactor: 0.66,
        screenOffset: { x: 0, y: 0.0, z: 0.08},  // Will need adjustment
        positionOffsetFactor: 0.5,
        cornerRadiusFactor: 0.04,
        modelRotation: { x: 0, y: 0, z: 0 }  // Adjust to correct model tilt (in degrees)
    }
};

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

    // Create renderer - disable antialiasing for faster interactive performance
    // Quality rendering is done at export time with higher resolution
    threeRenderer = new THREE.WebGLRenderer({
        antialias: false,  // Disable for better performance
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance'
    });
    threeRenderer.setSize(400, 700);
    // Use device pixel ratio of 1 for fastest interactive rendering
    threeRenderer.setPixelRatio(1);
    threeRenderer.outputEncoding = THREE.sRGBEncoding;
    threeRenderer.toneMapping = THREE.NoToneMapping;
    // Disable automatic clearing - we control this manually
    threeRenderer.autoClear = false;

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

    // Add orbit controls (disabled - we use custom drag handling for better performance)
    // orbitControls = new THREE.OrbitControls(threeCamera, threeRenderer.domElement);
    // orbitControls.enableDamping = true;
    // orbitControls.dampingFactor = 0.05;
    // orbitControls.enableZoom = false;
    // orbitControls.enablePan = false;
    // orbitControls.rotateSpeed = 0.5;
    // orbitControls.minPolarAngle = Math.PI / 4;
    // orbitControls.maxPolarAngle = Math.PI * 3 / 4;
    // orbitControls.minAzimuthAngle = -Math.PI / 3;
    // orbitControls.maxAzimuthAngle = Math.PI / 3;

    isThreeJSInitialized = true;

    // Load the phone model - check state for which device to use
    let deviceToLoad = 'iphone';
    if (typeof state !== 'undefined' && typeof getScreenshotSettings === 'function') {
        const ss = getScreenshotSettings();
        if (ss?.device3D) {
            deviceToLoad = ss.device3D;
        }
    }
    currentDeviceModel = deviceToLoad;
    loadPhoneModel();

    // Start animation loop
    animateThreeJS();
}

// Load the phone 3D model based on currentDeviceModel
function loadPhoneModel() {
    if (phoneModelLoading) return; // Prevent double loading
    phoneModelLoading = true;

    const config = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;
    const loader = new THREE.GLTFLoader();

    loader.load(
        config.modelPath,
        (gltf) => {
            phoneModelLoading = false;
            phoneModel = gltf.scene;

            // Center and scale the model
            const box = new THREE.Box3().setFromObject(phoneModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            // Center the model
            phoneModel.position.sub(center);

            // Scale to fit view (3.75 = 2.5 * 1.5 to match 2D scale at 100%)
            const maxDim = Math.max(size.x, size.y, size.z);
            baseModelScale = 3.75 / maxDim;
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

            // Create a pivot group for rotation around screen center
            const config = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;
            const screenOffset = config.screenOffset;

            phonePivot = new THREE.Group();

            // Offset the phone model so the screen center is at the pivot's origin
            phoneModel.position.set(
                -screenOffset.x * baseModelScale,
                -screenOffset.y * baseModelScale,
                -screenOffset.z * baseModelScale
            );

            phonePivot.add(phoneModel);
            threeScene.add(phonePivot);

            // Create a custom screen plane overlay since the model's UV mapping may be incorrect
            createScreenOverlay();

            phoneModelLoaded = true;

            // Apply initial settings from state
            if (typeof state !== 'undefined') {
                updateThreeJSBackground();
                const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : state.defaults?.screenshot;
                const rotation3D = ss?.rotation3D || { x: 0, y: 0, z: 0 };
                setThreeJSRotation(rotation3D.x, rotation3D.y, rotation3D.z);

                // Apply screenshot texture
                if (state.screenshots.length > 0) {
                    updateScreenTexture();
                }

                // Refresh canvas now that model is loaded (needed for side previews too)
                if (typeof updateCanvas === 'function') {
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

// Switch to a different phone model
function switchPhoneModel(deviceType) {
    if (!deviceConfigs[deviceType]) {
        console.error('Unknown device type:', deviceType);
        return;
    }

    // Skip if same device and already loaded or loading
    if (currentDeviceModel === deviceType && (phoneModelLoaded || phoneModelLoading)) {
        return;
    }

    // Update current device type
    currentDeviceModel = deviceType;
    phoneModelLoading = false; // Reset so we can load the new one

    // Remove current pivot (which contains the model) from scene
    if (phonePivot && threeScene) {
        threeScene.remove(phonePivot);
        phonePivot.traverse((child) => {
            if (child.isMesh) {
                child.geometry?.dispose();
                child.material?.dispose();
            }
        });
        phonePivot = null;
        phoneModel = null;
    }

    // Clean up screen plane
    if (customScreenPlane) {
        if (customScreenPlane.parent) {
            customScreenPlane.parent.remove(customScreenPlane);
        }
        customScreenPlane.geometry?.dispose();
        customScreenPlane.material?.dispose();
        customScreenPlane = null;
    }

    screenMesh = null;
    phoneModelLoaded = false;

    // Load new model using the config
    const config = deviceConfigs[currentDeviceModel];
    const loader = new THREE.GLTFLoader();

    loader.load(
        config.modelPath,
        (gltf) => {
            phoneModel = gltf.scene;

            // Center and scale the model
            const box = new THREE.Box3().setFromObject(phoneModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            phoneModel.position.sub(center);

            const maxDim = Math.max(size.x, size.y, size.z);
            baseModelScale = 3.75 / maxDim;
            phoneModel.scale.setScalar(baseModelScale);

            // Create a pivot group for rotation around screen center
            const screenOffset = config.screenOffset;
            phonePivot = new THREE.Group();

            // Offset the phone model so the screen center is at the pivot's origin
            phoneModel.position.set(
                -screenOffset.x * baseModelScale,
                -screenOffset.y * baseModelScale,
                -screenOffset.z * baseModelScale
            );

            phonePivot.add(phoneModel);
            threeScene.add(phonePivot);

            // Create screen overlay for this device
            createScreenOverlay();

            phoneModelLoaded = true;

            // Apply settings
            if (typeof state !== 'undefined') {
                updateThreeJSBackground();
                const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : state.defaults?.screenshot;
                const rotation3D = ss?.rotation3D || { x: 0, y: 0, z: 0 };
                setThreeJSRotation(rotation3D.x, rotation3D.y, rotation3D.z);

                if (state.screenshots.length > 0) {
                    updateScreenTexture();
                }

                // Only call updateCanvas if not suppressed (e.g., during slide transitions)
                if (typeof updateCanvas === 'function' && !window.suppressSwitchModelUpdate) {
                    updateCanvas();
                }
            }

            console.log(deviceType + ' model loaded successfully');
        },
        (progress) => {
            const percent = Math.round(progress.loaded / progress.total * 100);
            console.log('Loading ' + deviceType + ' model... ' + percent + '%');
        },
        (error) => {
            console.error('Error loading ' + deviceType + ' model:', error);
        }
    );
}

// Load a phone model into the cache (for side preview rendering with different devices)
function loadCachedPhoneModel(deviceType) {
    if (!deviceConfigs[deviceType]) return Promise.reject('Unknown device type');

    // Already loaded or loading
    if (phoneModelCache[deviceType]?.loaded) {
        return Promise.resolve(phoneModelCache[deviceType]);
    }
    if (phoneModelCache[deviceType]?.loading) {
        return phoneModelCache[deviceType].loadingPromise;
    }

    const config = deviceConfigs[deviceType];
    const loader = new THREE.GLTFLoader();

    phoneModelCache[deviceType] = { loading: true, loaded: false };

    phoneModelCache[deviceType].loadingPromise = new Promise((resolve, reject) => {
        loader.load(
            config.modelPath,
            (gltf) => {
                const model = gltf.scene;

                // Center and scale the model
                const box = new THREE.Box3().setFromObject(model);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());

                model.position.sub(center);

                const maxDim = Math.max(size.x, size.y, size.z);
                const modelBaseScale = 3.75 / maxDim;
                model.scale.setScalar(modelBaseScale);

                // Create pivot for this model
                const screenOffset = config.screenOffset;
                const pivot = new THREE.Group();

                model.position.set(
                    -screenOffset.x * modelBaseScale,
                    -screenOffset.y * modelBaseScale,
                    -screenOffset.z * modelBaseScale
                );

                pivot.add(model);

                // Create screen plane for this model
                const aspectRatio = config.aspectRatio;
                const planeHeight = 4.3 * config.screenHeightFactor;
                const planeWidth = planeHeight * aspectRatio;

                const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
                const material = new THREE.MeshBasicMaterial({
                    color: 0x111111,
                    side: THREE.DoubleSide
                });

                const screenPlane = new THREE.Mesh(geometry, material);
                screenPlane.position.set(screenOffset.x, screenOffset.y, screenOffset.z);

                const modelRot = config.modelRotation || { x: 0, y: 0, z: 0 };
                screenPlane.rotation.set(
                    -modelRot.x * Math.PI / 180,
                    -modelRot.y * Math.PI / 180,
                    -modelRot.z * Math.PI / 180
                );

                model.add(screenPlane);

                phoneModelCache[deviceType] = {
                    model: model,
                    pivot: pivot,
                    screenPlane: screenPlane,
                    baseScale: modelBaseScale,
                    loaded: true,
                    loading: false
                };

                console.log('Cached ' + deviceType + ' model for side previews');
                resolve(phoneModelCache[deviceType]);
            },
            undefined,
            (error) => {
                console.error('Error loading cached ' + deviceType + ' model:', error);
                phoneModelCache[deviceType] = { loading: false, loaded: false };
                reject(error);
            }
        );
    });

    return phoneModelCache[deviceType].loadingPromise;
}

// Preload all device models for side previews
function preloadAllPhoneModels() {
    const deviceTypes = Object.keys(deviceConfigs);
    return Promise.all(deviceTypes.map(type => loadCachedPhoneModel(type).catch(() => null)));
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

    const config = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;

    // Use device-specific aspect ratio and screen size
    const aspectRatio = config.aspectRatio;
    const planeHeight = 4.3 * config.screenHeightFactor;
    const planeWidth = planeHeight * aspectRatio;

    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const material = new THREE.MeshBasicMaterial({
        color: 0x111111,
        side: THREE.DoubleSide
    });

    customScreenPlane = new THREE.Mesh(geometry, material);

    // Position at center of phone, slightly in front of glass
    const screenOffset = config.screenOffset;
    customScreenPlane.position.set(screenOffset.x, screenOffset.y, screenOffset.z);

    // Counter-rotate the screen to cancel out the model's base rotation
    // This keeps the screen facing forward when the pivot applies the base rotation
    const modelRot = config.modelRotation || { x: 0, y: 0, z: 0 };
    customScreenPlane.rotation.set(
        -modelRot.x * Math.PI / 180,
        -modelRot.y * Math.PI / 180,
        -modelRot.z * Math.PI / 180
    );

    // Add directly to phoneModel so it moves with it
    phoneModel.add(customScreenPlane);

    // basePositionOffset is no longer needed since we use pivot-based rotation
    basePositionOffset.y = 0;

    console.log('Created screen overlay for ' + currentDeviceModel + ' at:', customScreenPlane.position);
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
    // Use getScreenshotImage() for localized image support
    const screenshotImage = typeof getScreenshotImage === 'function'
        ? getScreenshotImage(screenshot)
        : screenshot?.image;
    if (!screenshot || !screenshotImage) return;

    // Create texture from screenshot
    if (screenTexture) {
        screenTexture.dispose();
    }

    // Create rounded corner version of the image using device-specific corner radius
    const config = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;
    const cornerRadius = Math.round(screenshotImage.width * config.cornerRadiusFactor);
    const roundedImage = createRoundedScreenImage(screenshotImage, cornerRadius);

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

    // Trigger render update
    requestThreeJSRender();
}

// Set 3D rotation from sliders (in degrees)
function setThreeJSRotation(rotX, rotY, rotZ) {
    if (!phonePivot) return;

    // Add the device's base model rotation to the user's rotation
    const config = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;
    const modelRot = config.modelRotation || { x: 0, y: 0, z: 0 };

    console.log('setThreeJSRotation:', currentDeviceModel, 'modelRot:', modelRot, 'user:', rotX, rotY, rotZ);

    // Rotate the pivot (which rotates around the screen center)
    phonePivot.rotation.x = (rotX + modelRot.x) * Math.PI / 180;
    phonePivot.rotation.y = (rotY + modelRot.y) * Math.PI / 180;
    phonePivot.rotation.z = (rotZ + modelRot.z) * Math.PI / 180;

    // Trigger render update
    requestThreeJSRender();
}

// Set 3D scale
function setThreeJSScale(scale) {
    if (!phoneModel) return;

    phoneModel.scale.setScalar(baseModelScale * (scale / 100));

    // Trigger render update
    requestThreeJSRender();
}

// Render on demand instead of continuous animation loop
let renderRequested = false;

function requestThreeJSRender() {
    if (renderRequested) return;
    renderRequested = true;
    requestAnimationFrame(() => {
        renderRequested = false;
        if (threeRenderer && threeScene && threeCamera) {
            threeRenderer.clear();
            threeRenderer.render(threeScene, threeCamera);
        }
    });
}

// Legacy function name for compatibility - now triggers on-demand render
function animateThreeJS() {
    requestThreeJSRender();
}

// Render 3D phone only (with transparent background) to be composited
function renderThreeJSToCanvas(targetCanvas, width, height) {
    if (!threeRenderer || !threeScene || !threeCamera || !phonePivot) return;

    const dims = { width: width || 1290, height: height || 2796 };

    // Store original values
    const originalBackground = threeScene.background;
    const originalPosition = phonePivot.position.clone();
    const originalScale = phonePivot.scale.clone();
    const originalRotation = phonePivot.rotation.clone();

    // Apply position, scale, and rotation from screenshot settings
    if (typeof state !== 'undefined') {
        // Use getScreenshotSettings() helper if available, otherwise fall back to defaults
        const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : state.defaults?.screenshot;
        if (ss) {
            // Scale: use screenshot.scale to adjust model size
            const screenshotScale = ss.scale / 100;
            phonePivot.scale.setScalar(screenshotScale);

            // Position: convert percentage to 3D space offset
            // X: 0% = left, 50% = center, 100% = right
            // Y: 0% = top, 50% = center, 100% = bottom
            const xOffset = ((ss.x - 50) / 50) * 2; // -2 to 2 range
            const yOffset = -((ss.y - 50) / 50) * 3; // -3 to 3 range (inverted for 3D)
            phonePivot.position.set(
                xOffset + basePositionOffset.x,
                yOffset + basePositionOffset.y,
                basePositionOffset.z
            );

            // Rotation: apply 3D rotation from current screenshot settings + model base rotation
            const rotation3D = ss.rotation3D || { x: 0, y: 0, z: 0 };
            const config = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;
            const modelRot = config.modelRotation || { x: 0, y: 0, z: 0 };
            phonePivot.rotation.set(
                (rotation3D.x + modelRot.x) * Math.PI / 180,
                (rotation3D.y + modelRot.y) * Math.PI / 180,
                (rotation3D.z + modelRot.z) * Math.PI / 180
            );
        }
    }

    // Set transparent background for compositing
    threeScene.background = null;
    threeRenderer.setClearColor(0x000000, 0); // Fully transparent clear color

    // Temporarily resize renderer
    const oldSize = { width: 400, height: 700 };
    threeRenderer.setSize(dims.width, dims.height);
    threeCamera.aspect = dims.width / dims.height;
    threeCamera.updateProjectionMatrix();

    // Clear the renderer before drawing (ensures clean transparency)
    threeRenderer.clear();

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
    phonePivot.position.copy(originalPosition);
    phonePivot.scale.copy(originalScale);
    phonePivot.rotation.copy(originalRotation);
}

// Render 3D for a specific screenshot index (used for side previews)
function renderThreeJSForScreenshot(targetCanvas, width, height, screenshotIndex) {
    if (!threeRenderer || !threeScene || !threeCamera) return;
    if (typeof state === 'undefined' || !state.screenshots[screenshotIndex]) return;

    const screenshot = state.screenshots[screenshotIndex];
    const ss = screenshot.screenshot;
    const dims = { width: width || 1290, height: height || 2796 };

    // Determine which device model this screenshot uses
    const screenshotDeviceType = ss.device3D || 'iphone';
    const config = deviceConfigs[screenshotDeviceType] || deviceConfigs.iphone;

    // Check if this screenshot uses the same device as currently active
    const useCurrentModel = screenshotDeviceType === currentDeviceModel && phonePivot;

    // Get the model to use (either current or from cache)
    let pivotToUse, screenPlaneToUse;

    if (useCurrentModel) {
        // Use the currently loaded model
        pivotToUse = phonePivot;
        screenPlaneToUse = customScreenPlane;
    } else {
        // Use cached model for different device
        const cached = phoneModelCache[screenshotDeviceType];
        if (!cached?.loaded) {
            // Model not cached yet - trigger loading and skip this render
            loadCachedPhoneModel(screenshotDeviceType).then(() => {
                // Trigger a re-render once model is loaded
                if (typeof updateCanvas === 'function') {
                    updateCanvas();
                }
            });
            return;
        }
        pivotToUse = cached.pivot;
        screenPlaneToUse = cached.screenPlane;

        // Add cached pivot to scene temporarily
        threeScene.add(pivotToUse);
    }

    // Store original values
    const originalBackground = threeScene.background;
    const originalPosition = pivotToUse.position.clone();
    const originalScale = pivotToUse.scale.clone();
    const originalRotation = pivotToUse.rotation.clone();

    // Hide the current model if we're using a different one
    if (!useCurrentModel && phonePivot) {
        phonePivot.visible = false;
    }

    // Temporarily update screen texture for this screenshot
    // Use getScreenshotImage() for localized image support
    const screenshotImage = typeof getScreenshotImage === 'function'
        ? getScreenshotImage(screenshot)
        : screenshot?.image;
    const oldMaterial = screenPlaneToUse ? screenPlaneToUse.material : null;
    if (screenshotImage && screenPlaneToUse) {
        const cornerRadius = Math.round(screenshotImage.width * config.cornerRadiusFactor);
        const roundedImage = createRoundedScreenImage(screenshotImage, cornerRadius);
        const newTexture = new THREE.Texture(roundedImage);
        newTexture.needsUpdate = true;
        newTexture.encoding = THREE.sRGBEncoding;
        newTexture.flipY = true;

        const newMaterial = new THREE.MeshBasicMaterial({
            map: newTexture,
            side: THREE.FrontSide,
            transparent: true
        });
        screenPlaneToUse.material = newMaterial;
    }

    // Apply rotation for this screenshot + model base rotation
    const rotation3D = ss.rotation3D || { x: 0, y: 0, z: 0 };
    const modelRot = config.modelRotation || { x: 0, y: 0, z: 0 };
    pivotToUse.rotation.set(
        (rotation3D.x + modelRot.x) * Math.PI / 180,
        (rotation3D.y + modelRot.y) * Math.PI / 180,
        (rotation3D.z + modelRot.z) * Math.PI / 180
    );

    // Apply scale and position
    const screenshotScale = ss.scale / 100;
    pivotToUse.scale.setScalar(screenshotScale);
    const xOffset = ((ss.x - 50) / 50) * 2;
    const yOffset = -((ss.y - 50) / 50) * 3;
    pivotToUse.position.set(
        xOffset + basePositionOffset.x,
        yOffset + basePositionOffset.y,
        basePositionOffset.z
    );

    // Set transparent background for compositing
    threeScene.background = null;
    threeRenderer.setClearColor(0x000000, 0); // Fully transparent clear color

    // Temporarily resize renderer
    const oldSize = { width: 400, height: 700 };
    threeRenderer.setSize(dims.width, dims.height);
    threeCamera.aspect = dims.width / dims.height;
    threeCamera.updateProjectionMatrix();

    // Clear the renderer before drawing (ensures clean transparency)
    threeRenderer.clear();

    // Render with transparency
    threeRenderer.render(threeScene, threeCamera);

    // Draw to target canvas (composite 3D phone onto existing background)
    const ctx = targetCanvas.getContext('2d');
    ctx.drawImage(threeRenderer.domElement, 0, 0, dims.width, dims.height);

    // Restore everything
    threeRenderer.setSize(oldSize.width, oldSize.height);
    threeCamera.aspect = oldSize.width / oldSize.height;
    threeCamera.updateProjectionMatrix();
    threeScene.background = originalBackground;
    pivotToUse.position.copy(originalPosition);
    pivotToUse.scale.copy(originalScale);
    pivotToUse.rotation.copy(originalRotation);

    // Restore original material
    if (oldMaterial && screenPlaneToUse) {
        // Dispose the temporary material
        if (screenPlaneToUse.material !== oldMaterial) {
            screenPlaneToUse.material.map?.dispose();
            screenPlaneToUse.material.dispose();
        }
        screenPlaneToUse.material = oldMaterial;
    }

    // Clean up: remove cached model from scene and restore current model visibility
    if (!useCurrentModel) {
        threeScene.remove(pivotToUse);
        if (phonePivot) {
            phonePivot.visible = true;
        }
    }
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

    // Apply current rotation and background
    if (show && typeof state !== 'undefined') {
        updateThreeJSBackground();
        if (phoneModel) {
            const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : state.defaults?.screenshot;
            const rotation3D = ss?.rotation3D || { x: 0, y: 0, z: 0 };
            setThreeJSRotation(rotation3D.x, rotation3D.y, rotation3D.z);
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

    // Use getBackground() helper if available, otherwise fall back to defaults
    const bg = typeof getBackground === 'function' ? getBackground() : state.defaults?.background;
    if (!bg) return;

    if (bg.type === 'solid') {
        threeScene.background = new THREE.Color(bg.solid);
    } else if (bg.type === 'gradient') {
        // Use the first gradient color as background (Three.js doesn't support gradients natively)
        const firstStop = bg.gradient.stops[0];
        if (firstStop) {
            threeScene.background = new THREE.Color(firstStop.color);
        }
    } else {
        // For image backgrounds, use a neutral color
        threeScene.background = new THREE.Color(0x1a1a2e);
    }

    // Trigger render update
    requestThreeJSRender();
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

// Interactive rotation/movement for 2D canvas in 3D mode
let isDragging3D = false;
let isAltDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let dragUpdatePending = false;

function getUse3D() {
    if (typeof getScreenshotSettings === 'function') {
        const ss = getScreenshotSettings();
        return ss?.use3D || false;
    }
    return state.defaults?.screenshot?.use3D || false;
}

function setup3DCanvasInteraction() {
    const canvas = document.getElementById('preview-canvas');
    if (!canvas) return;

    canvas.addEventListener('mousedown', (e) => {
        if (typeof state !== 'undefined' && getUse3D()) {
            isDragging3D = true;
            isAltDragging = e.altKey;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            canvas.style.cursor = isAltDragging ? 'move' : 'grabbing';
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!isDragging3D || typeof state === 'undefined' || !getUse3D()) return;

        const deltaX = e.clientX - lastMouseX;
        const deltaY = e.clientY - lastMouseY;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        // Get current screenshot settings
        const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : state.defaults?.screenshot;
        if (!ss) return;

        if (isAltDragging) {
            // Alt+drag: move position (x, y)
            ss.x = Math.max(0, Math.min(100, ss.x + deltaX * 0.2));
            ss.y = Math.max(0, Math.min(100, ss.y + deltaY * 0.2));

            // Update sliders
            document.getElementById('screenshot-x').value = ss.x;
            document.getElementById('screenshot-x-value').textContent = Math.round(ss.x) + '%';
            document.getElementById('screenshot-y').value = ss.y;
            document.getElementById('screenshot-y-value').textContent = Math.round(ss.y) + '%';
        } else {
            // Regular drag: rotate
            if (!ss.rotation3D) ss.rotation3D = { x: 0, y: 0, z: 0 };

            ss.rotation3D.y = Math.max(-45, Math.min(45, ss.rotation3D.y + deltaX * 0.5));
            ss.rotation3D.x = Math.max(-45, Math.min(45, ss.rotation3D.x + deltaY * 0.5));

            // Update sliders
            document.getElementById('rotation-3d-y').value = ss.rotation3D.y;
            document.getElementById('rotation-3d-y-value').textContent = Math.round(ss.rotation3D.y) + '°';
            document.getElementById('rotation-3d-x').value = ss.rotation3D.x;
            document.getElementById('rotation-3d-x-value').textContent = Math.round(ss.rotation3D.x) + '°';

            // Apply rotation directly to model (fast path - skip full updateCanvas)
            setThreeJSRotation(ss.rotation3D.x, ss.rotation3D.y, ss.rotation3D.z);
        }

        // Throttle updateCanvas calls using requestAnimationFrame
        if (!dragUpdatePending) {
            dragUpdatePending = true;
            requestAnimationFrame(() => {
                dragUpdatePending = false;
                if (typeof updateCanvas === 'function') {
                    updateCanvas();
                }
            });
        }
    });

    canvas.addEventListener('mouseup', () => {
        if (isDragging3D) {
            isDragging3D = false;
            isAltDragging = false;
            canvas.style.cursor = getUse3D() ? 'grab' : '';
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (isDragging3D) {
            isDragging3D = false;
            isAltDragging = false;
            canvas.style.cursor = '';
        }
    });

    // Change cursor when hovering in 3D mode
    canvas.addEventListener('mouseenter', () => {
        if (typeof state !== 'undefined' && getUse3D()) {
            canvas.style.cursor = 'grab';
        }
    });
}

// Initialize interaction when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup3DCanvasInteraction);
} else {
    setup3DCanvasInteraction();
}
