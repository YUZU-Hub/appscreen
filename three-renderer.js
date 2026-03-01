// Three.js 3D Renderer for device mockups

console.log('[3D] three-renderer build: ipad-angle-v6-ipad-no-rounding-only');

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
let activeModelLoadRequestId = 0;

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
// Runtime-resolved screen anchors per device
let resolvedScreenAnchors = {}; // { deviceType: { offset: {x,y,z}, size: {x,y,z}|null, source } }

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
    },
    ipad: {
        modelPath: 'models/ipad_pro.glb',
        aspectRatio: 2048 / 2732,
        screenHeightFactor: 0.814,
        // Calibrated to the iPad inner display area in model-local units.
        screenOffset: { x: -0.00048, y: 0.14044, z: 1.495 },
        // Fine tune while keeping autoDetectScreenAnchor=true (use tiny values).
        screenOffsetNudge: { x: 0, y: 0.000006, z: 0 },
        screenPlaneSize: { width: 0.0019, height: 0.0025 },
        screenDepthOffset: 0.0000,
        positionOffsetFactor: 0.6,
        cornerRadiusFactor: 0.0,
        modelRotation: { x: 0, y: 0, z: 0 },
        autoDetectScreenAnchor: true,
        screenAnchorHints: ['black_front', 'front_texture', 'screen', 'display', 'glass'],
        screenSizeMultiplier: 1.065,
        modelScaleMultiplier: 0.72
    }
};

function detectScreenAnchor(model, config) {
    const hints = (config.screenAnchorHints && config.screenAnchorHints.length > 0)
        ? config.screenAnchorHints.map(h => h.toLowerCase())
        : ['screen', 'display', 'glass', 'front'];

    model.updateMatrixWorld(true);
    const modelWorldQuaternion = new THREE.Quaternion();
    model.getWorldQuaternion(modelWorldQuaternion);
    const inverseModelWorldQuaternion = modelWorldQuaternion.clone().invert();

    let best = null;

    model.traverse((child) => {
        if (!child.isMesh || !child.geometry) return;

        const name = (child.name || '').toLowerCase();
        const materialNameRaw = Array.isArray(child.material)
            ? child.material.map(m => m?.name || '').join(' ')
            : (child.material?.name || '');
        const materialName = materialNameRaw.toLowerCase();

        const matchesHint = hints.some((hint) => name.includes(hint) || materialName.includes(hint));
        if (!matchesHint) return;

        const boxWorld = new THREE.Box3().setFromObject(child);
        if (!Number.isFinite(boxWorld.min.x) || !Number.isFinite(boxWorld.max.x)) return;

        const centerWorld = boxWorld.getCenter(new THREE.Vector3());
        const sizeWorld = boxWorld.getSize(new THREE.Vector3());
        const centerLocal = model.worldToLocal(centerWorld.clone());
        const childWorldQuaternion = new THREE.Quaternion();
        child.getWorldQuaternion(childWorldQuaternion);
        const rotationLocal = inverseModelWorldQuaternion.clone().multiply(childWorldQuaternion);

        const modelScale = model.scale.x || 1;
        const sizeLocal = sizeWorld.clone().multiplyScalar(1 / modelScale);
        const areaWorld = Math.max(0, sizeWorld.x * sizeWorld.y);
        const aspect = (sizeWorld.y !== 0) ? Math.abs(sizeWorld.x / sizeWorld.y) : 0;
        const targetAspect = config.aspectRatio || 1;
        const aspectError = aspect > 0 ? Math.abs(Math.log(aspect / targetAspect)) : Number.POSITIVE_INFINITY;
        const aspectScore = Number.isFinite(aspectError) ? Math.max(0, 1 - aspectError) : 0;

        let bonus = 0;
        if (materialName.includes('black_front')) bonus += 5000;
        if (materialName.includes('front_texture')) bonus += 4000;
        if (materialName.includes('screen') || materialName.includes('display')) bonus += 3000;
        if (materialName.includes('glass')) bonus += 1500;
        if (name.includes('screen') || name.includes('display')) bonus += 1500;

        // Strongly prioritize aspect-ratio match to avoid picking front/bezel helper meshes.
        const score = aspectScore * 1_000_000_000 + areaWorld * 100_000 + centerLocal.z * 10_000 + bonus;

        if (!best || score > best.score) {
            best = {
                score,
                meshName: child.name || '',
                materialName: materialNameRaw || '',
                offset: { x: centerLocal.x, y: centerLocal.y, z: centerLocal.z },
                size: { x: sizeLocal.x, y: sizeLocal.y, z: sizeLocal.z },
                rotationQuaternion: {
                    x: rotationLocal.x,
                    y: rotationLocal.y,
                    z: rotationLocal.z,
                    w: rotationLocal.w
                }
            };
        }
    });

    if (!best) return null;

    return {
        offset: best.offset,
        size: best.size,
        rotationQuaternion: best.rotationQuaternion,
        source: 'auto-detected',
        meshName: best.meshName,
        materialName: best.materialName
    };
}

function getScreenOffsetNudge(config) {
    const n = config?.screenOffsetNudge || {};
    return {
        x: Number.isFinite(n.x) ? n.x : 0,
        y: Number.isFinite(n.y) ? n.y : 0,
        z: Number.isFinite(n.z) ? n.z : 0
    };
}

function resolveScreenAnchorForDevice(model, deviceType, config) {
    const nudge = getScreenOffsetNudge(config);
    if (config.autoDetectScreenAnchor) {
        const detected = detectScreenAnchor(model, config);
        if (detected) {
            resolvedScreenAnchors[deviceType] = {
                offset: {
                    x: detected.offset.x + nudge.x,
                    y: detected.offset.y + nudge.y,
                    z: detected.offset.z + nudge.z
                },
                size: detected.size ? { ...detected.size } : null,
                rotationQuaternion: detected.rotationQuaternion ? { ...detected.rotationQuaternion } : null,
                source: detected.source
            };
            return resolvedScreenAnchors[deviceType];
        }
    }

    resolvedScreenAnchors[deviceType] = {
        offset: {
            x: (config.screenOffset?.x || 0) + nudge.x,
            y: (config.screenOffset?.y || 0) + nudge.y,
            z: (config.screenOffset?.z || 0) + nudge.z
        },
        size: null,
        rotationQuaternion: null,
        source: 'config'
    };
    return resolvedScreenAnchors[deviceType];
}

function getScreenPlaneSize(config, screenAnchor) {
    if (config.screenPlaneSize?.width > 0 && config.screenPlaneSize?.height > 0) {
        const multiplier = config.screenSizeMultiplier || 1;
        return {
            width: config.screenPlaneSize.width * multiplier,
            height: config.screenPlaneSize.height * multiplier,
            source: 'config-plane-size'
        };
    }

    if (screenAnchor?.size?.x > 0 && screenAnchor?.size?.y > 0) {
        const multiplier = config.screenSizeMultiplier || 1;
        let width = screenAnchor.size.x * multiplier;
        let height = screenAnchor.size.y * multiplier;
        const targetAspect = config.aspectRatio || 0;

        // Keep the detected screen plane coherent with device aspect ratio.
        if (targetAspect > 0 && width > 0 && height > 0) {
            const currentAspect = width / height;
            const aspectDelta = Math.abs(currentAspect - targetAspect) / targetAspect;
            if (Number.isFinite(aspectDelta) && aspectDelta > 0.08) {
                if (currentAspect > targetAspect) {
                    width = height * targetAspect;
                } else {
                    height = width / targetAspect;
                }
            }
        }

        return {
            width,
            height,
            source: 'anchor-size'
        };
    }

    const height = 4.3 * config.screenHeightFactor;
    return {
        width: height * config.aspectRatio,
        height: height,
        source: 'config-size'
    };
}

function getModelRenderScale(baseScale, config) {
    const multiplier = config.modelScaleMultiplier || 1;
    return baseScale * multiplier;
}

function recenterIpadModelIfNeeded(model, deviceType) {
    if (deviceType !== 'ipad') return;

    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const threshold = 5;
    const isFar =
        Math.abs(center.x) > threshold ||
        Math.abs(center.y) > threshold ||
        Math.abs(center.z) > threshold;

    if (!isFar) return;

    model.position.sub(center);
    model.updateMatrixWorld(true);

    const fixedBox = new THREE.Box3().setFromObject(model);
    const fixedCenter = fixedBox.getCenter(new THREE.Vector3());
    console.log('[3D][iPad] recentered model', {
        beforeCenter: { x: center.x, y: center.y, z: center.z },
        afterCenter: { x: fixedCenter.x, y: fixedCenter.y, z: fixedCenter.z }
    });
}

function shouldForceOverlayOnTop(deviceType) {
    return deviceType !== 'ipad';
}

function getScreenPlaneRenderOrder(deviceType) {
    return shouldForceOverlayOnTop(deviceType) ? 10 : -1;
}

function applyScreenPlaneRotation(screenPlane, screenAnchor, config) {
    const anchorQuat = screenAnchor?.rotationQuaternion;
    if (anchorQuat && Number.isFinite(anchorQuat.x) && Number.isFinite(anchorQuat.y) && Number.isFinite(anchorQuat.z) && Number.isFinite(anchorQuat.w)) {
        screenPlane.quaternion.set(anchorQuat.x, anchorQuat.y, anchorQuat.z, anchorQuat.w);
        return;
    }

    const modelRot = config.modelRotation || { x: 0, y: 0, z: 0 };
    screenPlane.rotation.set(
        -modelRot.x * Math.PI / 180,
        -modelRot.y * Math.PI / 180,
        -modelRot.z * Math.PI / 180
    );
}

function createScreenMaterial(texture, deviceType) {
    const forceOnTop = shouldForceOverlayOnTop(deviceType);
    if (!forceOnTop) {
        // iPad: render in opaque pipeline with alpha cutout so bezel/frame depth occlusion works correctly.
        return new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.FrontSide,
            transparent: false,
            alphaTest: 0.01,
            depthTest: true,
            depthWrite: true
        });
    }
    return new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2
    });
}

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

    const requestedDevice = currentDeviceModel;
    const config = deviceConfigs[requestedDevice] || deviceConfigs.iphone;
    const requestId = ++activeModelLoadRequestId;
    const loader = new THREE.GLTFLoader();

    loader.load(
        config.modelPath,
        (gltf) => {
            // Ignore stale async responses from older model requests.
            if (requestId !== activeModelLoadRequestId) {
                gltf.scene?.traverse((child) => {
                    if (child.isMesh) {
                        child.geometry?.dispose();
                        child.material?.dispose?.();
                    }
                });
                return;
            }

            phoneModelLoading = false;
            phoneModel = gltf.scene;
            currentDeviceModel = requestedDevice;

            // Center and scale the model
            const box = new THREE.Box3().setFromObject(phoneModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            // Center the model
            phoneModel.position.sub(center);

            // Scale to fit view (3.75 = 2.5 * 1.5 to match 2D scale at 100%)
            const maxDim = Math.max(size.x, size.y, size.z);
            baseModelScale = 3.75 / maxDim;
            const modelRenderScale = getModelRenderScale(baseModelScale, config);
            phoneModel.scale.setScalar(modelRenderScale);

            // Create a pivot group for rotation around screen center
            const screenAnchor = resolveScreenAnchorForDevice(phoneModel, requestedDevice, config);
            const screenOffset = screenAnchor.offset;

            phonePivot = new THREE.Group();

            // Offset the phone model so the screen center is at the pivot's origin
            phoneModel.position.set(
                -screenOffset.x * modelRenderScale,
                -screenOffset.y * modelRenderScale,
                -screenOffset.z * modelRenderScale
            );
            recenterIpadModelIfNeeded(phoneModel, requestedDevice);

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

        },
        (progress) => {
            const percent = Math.round(progress.loaded / progress.total * 100);
            console.log('Loading phone model... ' + percent + '%');
        },
        (error) => {
            if (requestId !== activeModelLoadRequestId) {
                return;
            }
            phoneModelLoading = false;
            phoneModelLoaded = false;
            phoneModel = null;
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
    const requestedDevice = deviceType;
    const config = deviceConfigs[requestedDevice];
    const loader = new THREE.GLTFLoader();
    phoneModelLoading = true;
    const requestId = ++activeModelLoadRequestId;

    loader.load(
        config.modelPath,
        (gltf) => {
            // Ignore stale async responses from older model requests.
            if (requestId !== activeModelLoadRequestId) {
                gltf.scene?.traverse((child) => {
                    if (child.isMesh) {
                        child.geometry?.dispose();
                        child.material?.dispose?.();
                    }
                });
                return;
            }

            phoneModelLoading = false;
            phoneModel = gltf.scene;
            currentDeviceModel = requestedDevice;

            // Center and scale the model
            const box = new THREE.Box3().setFromObject(phoneModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            phoneModel.position.sub(center);

            const maxDim = Math.max(size.x, size.y, size.z);
            baseModelScale = 3.75 / maxDim;
            const modelRenderScale = getModelRenderScale(baseModelScale, config);
            phoneModel.scale.setScalar(modelRenderScale);

            // Create a pivot group for rotation around screen center
            const screenAnchor = resolveScreenAnchorForDevice(phoneModel, requestedDevice, config);
            const screenOffset = screenAnchor.offset;
            phonePivot = new THREE.Group();

            // Offset the phone model so the screen center is at the pivot's origin
            phoneModel.position.set(
                -screenOffset.x * modelRenderScale,
                -screenOffset.y * modelRenderScale,
                -screenOffset.z * modelRenderScale
            );
            recenterIpadModelIfNeeded(phoneModel, requestedDevice);

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

        },
        (progress) => {
            const percent = Math.round(progress.loaded / progress.total * 100);
            console.log('Loading ' + requestedDevice + ' model... ' + percent + '%');
        },
        (error) => {
            if (requestId !== activeModelLoadRequestId) {
                return;
            }
            phoneModelLoading = false;
            phoneModelLoaded = false;
            phoneModel = null;
            console.error('Error loading ' + requestedDevice + ' model:', error);
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
                const modelRenderScale = getModelRenderScale(modelBaseScale, config);
                model.scale.setScalar(modelRenderScale);

                // Create pivot for this model
                const screenAnchor = resolveScreenAnchorForDevice(model, deviceType, config);
                const screenOffset = screenAnchor.offset;
                const pivot = new THREE.Group();

                model.position.set(
                    -screenOffset.x * modelRenderScale,
                    -screenOffset.y * modelRenderScale,
                    -screenOffset.z * modelRenderScale
                );
                recenterIpadModelIfNeeded(model, deviceType);

                pivot.add(model);

                // Create screen plane for this model
                const planeSize = getScreenPlaneSize(config, screenAnchor);
                const planeHeight = planeSize.height;
                const planeWidth = planeSize.width;

                const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
                const forceOnTop = shouldForceOverlayOnTop(deviceType);
                const material = new THREE.MeshBasicMaterial({
                    color: 0x111111,
                    side: forceOnTop ? THREE.DoubleSide : THREE.FrontSide,
                    depthTest: true,
                    depthWrite: !forceOnTop,
                    polygonOffset: forceOnTop,
                    polygonOffsetFactor: forceOnTop ? -1 : 0,
                    polygonOffsetUnits: forceOnTop ? -2 : 0
                });

                const screenPlane = new THREE.Mesh(geometry, material);
                const depthOffset = config.screenDepthOffset || 0;
                screenPlane.position.set(screenOffset.x, screenOffset.y, screenOffset.z + depthOffset);
                screenPlane.renderOrder = getScreenPlaneRenderOrder(deviceType);
                applyScreenPlaneRotation(screenPlane, screenAnchor, config);

                model.add(screenPlane);

                phoneModelCache[deviceType] = {
                    model: model,
                    pivot: pivot,
                    screenPlane: screenPlane,
                    baseScale: modelRenderScale,
                    loaded: true,
                    loading: false
                };

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
    const screenAnchor = resolvedScreenAnchors[currentDeviceModel] || {
        offset: { ...config.screenOffset },
        size: null,
        rotationQuaternion: null,
        source: 'config'
    };
    const screenOffset = screenAnchor.offset;

    const planeSize = getScreenPlaneSize(config, screenAnchor);
    const planeHeight = planeSize.height;
    const planeWidth = planeSize.width;

    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const forceOnTop = shouldForceOverlayOnTop(currentDeviceModel);
    const material = new THREE.MeshBasicMaterial({
        color: 0x111111,
        side: forceOnTop ? THREE.DoubleSide : THREE.FrontSide,
        depthTest: true,
        depthWrite: !forceOnTop,
        polygonOffset: forceOnTop,
        polygonOffsetFactor: forceOnTop ? -1 : 0,
        polygonOffsetUnits: forceOnTop ? -2 : 0
    });

    customScreenPlane = new THREE.Mesh(geometry, material);
    customScreenPlane.renderOrder = getScreenPlaneRenderOrder(currentDeviceModel);

    // Position at center of phone, slightly in front of glass
    const depthOffset = config.screenDepthOffset || 0;
    customScreenPlane.position.set(screenOffset.x, screenOffset.y, screenOffset.z + depthOffset);

    // Match the detected screen-surface orientation when available.
    applyScreenPlaneRotation(customScreenPlane, screenAnchor, config);

    // Add directly to phoneModel so it moves with it
    phoneModel.add(customScreenPlane);

    if (currentDeviceModel === 'ipad') {
        console.log('[3D][iPad] overlay-v3', {
            build: 'ipad-angle-v3',
            planeLocal: { width: planeWidth, height: planeHeight },
            planeWorld: {
                width: planeWidth * phoneModel.scale.x,
                height: planeHeight * phoneModel.scale.y
            },
            modelScale: phoneModel.scale.x,
            depthOffset,
            renderOrder: customScreenPlane.renderOrder,
            screenOffset,
            planeRotationDeg: {
                x: customScreenPlane.rotation.x * (180 / Math.PI),
                y: customScreenPlane.rotation.y * (180 / Math.PI),
                z: customScreenPlane.rotation.z * (180 / Math.PI)
            },
            planeQuaternion: {
                x: customScreenPlane.quaternion.x,
                y: customScreenPlane.quaternion.y,
                z: customScreenPlane.quaternion.z,
                w: customScreenPlane.quaternion.w
            },
            anchorQuaternion: screenAnchor.rotationQuaternion || null,
            anchorSource: screenAnchor.source || 'config'
        });
    }

    // basePositionOffset is no longer needed since we use pivot-based rotation
    basePositionOffset.y = 0;

}

function createRoundedScreenImage(image, cornerRadius) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');

    const w = canvas.width;
    const h = canvas.height;
    const r = Math.max(0, Math.min(cornerRadius, Math.min(w, h) / 2));

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
    ctx.clip();
    ctx.drawImage(image, 0, 0);

    return canvas;
}

function getTextureSourceImageForDevice(image, deviceType) {
    if (!image) return image;
    if (deviceType === 'ipad') return image;

    const config = deviceConfigs[deviceType] || deviceConfigs.iphone;
    const factor = Number.isFinite(config.cornerRadiusFactor) ? config.cornerRadiusFactor : 0;
    if (factor <= 0) return image;

    const cornerRadius = Math.round(image.width * factor);
    if (cornerRadius <= 0) return image;
    return createRoundedScreenImage(image, cornerRadius);
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

    const textureSource = getTextureSourceImageForDevice(screenshotImage, currentDeviceModel);
    screenTexture = new THREE.Texture(textureSource);
    screenTexture.needsUpdate = true;
    screenTexture.encoding = THREE.sRGBEncoding;
    screenTexture.flipY = true;

    // Create a material for the screen with transparency for rounded corners
    const screenMaterial = createScreenMaterial(screenTexture, currentDeviceModel);

    // Apply to custom screen plane (preferred)
    if (customScreenPlane) {
        customScreenPlane.material.dispose();
        customScreenPlane.material = screenMaterial;
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

            // Position: match 2D behavior where available space depends on (1 - scale)
            // This ensures same percentages look the same in 2D and 3D
            // X uses smaller factor (1.1) since canvas is taller than wide (400x700 aspect)
            const availableSpaceY = (1 - screenshotScale) * 2;
            const availableSpaceX = (1 - screenshotScale) * 0.9;
            const xOffset = ((ss.x - 50) / 50) * availableSpaceX;
            const yOffset = -((ss.y - 50) / 50) * availableSpaceY; // Inverted for 3D
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
        const textureSource = getTextureSourceImageForDevice(screenshotImage, screenshotDeviceType);
        const newTexture = new THREE.Texture(textureSource);
        newTexture.needsUpdate = true;
        newTexture.encoding = THREE.sRGBEncoding;
        newTexture.flipY = true;

        const newMaterial = createScreenMaterial(newTexture, screenshotDeviceType);
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

    // Apply scale and position (matching 2D behavior)
    const screenshotScale = ss.scale / 100;
    pivotToUse.scale.setScalar(screenshotScale);
    const availableSpaceY = (1 - screenshotScale) * 2;
    const availableSpaceX = (1 - screenshotScale) * 0.9;
    const xOffset = ((ss.x - 50) / 50) * availableSpaceX;
    const yOffset = -((ss.y - 50) / 50) * availableSpaceY;
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

function getRotationLimitsForActiveDevice(ss) {
    const device3D = ss?.device3D || currentDeviceModel || 'iphone';
    if (typeof window.getRotationLimitsForDevice3D === 'function') {
        return window.getRotationLimitsForDevice3D(device3D);
    }
    return { xMin: -45, xMax: 45, yMin: -45, yMax: 45, zMin: -45, zMax: 45 };
}

function getPositionYLimitsForActiveDevice(ss) {
    const device3D = ss?.device3D || currentDeviceModel || 'iphone';
    if (typeof window.getPositionYLimitsForDevice3D === 'function') {
        return window.getPositionYLimitsForDevice3D(device3D);
    }
    return { min: -30, max: 130 };
}

function getPositionYPercentForActiveDevice(ss) {
    const y = ss?.y ?? 60;
    if (typeof window.positionYToSliderPercent === 'function') {
        return window.positionYToSliderPercent(y, ss?.device3D || currentDeviceModel || 'iphone');
    }
    const limits = getPositionYLimitsForActiveDevice(ss);
    const span = limits.max - limits.min;
    const sliderMin = -130;
    const sliderMax = 230;
    const sliderSpan = sliderMax - sliderMin;
    if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(sliderSpan) || sliderSpan <= 0) return 50;
    const rawRatio = (y - limits.min) / span;
    const sliderValue = sliderMin + rawRatio * sliderSpan;
    return Math.max(sliderMin, Math.min(sliderMax, sliderValue));
}

function clampRotationToActiveLimits(ss) {
    if (!ss.rotation3D) ss.rotation3D = { x: 0, y: 0, z: 0 };
    const limits = getRotationLimitsForActiveDevice(ss);
    ss.rotation3D.x = Math.max(limits.xMin, Math.min(limits.xMax, ss.rotation3D.x));
    ss.rotation3D.y = Math.max(limits.yMin, Math.min(limits.yMax, ss.rotation3D.y));
    ss.rotation3D.z = Math.max(limits.zMin, Math.min(limits.zMax, ss.rotation3D.z));
    return limits;
}

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
        // Don't rotate 3D device while dragging an element
        const wrapper = document.getElementById('canvas-wrapper');
        if (wrapper && wrapper.classList.contains('element-dragging')) {
            isDragging3D = false;
            isAltDragging = false;
            canvas.style.cursor = '';
            return;
        }

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
            const yLimits = getPositionYLimitsForActiveDevice(ss);
            ss.y = Math.max(yLimits.min, Math.min(yLimits.max, ss.y + deltaY * 0.2));

            // Update sliders
            document.getElementById('screenshot-x').value = ss.x;
            document.getElementById('screenshot-x-value').textContent = Math.round(ss.x) + '%';
            const yPercent = getPositionYPercentForActiveDevice(ss);
            document.getElementById('screenshot-y').value = yPercent;
            document.getElementById('screenshot-y-value').textContent = formatValue(yPercent);
        } else {
            // Regular drag: rotate
            if (!ss.rotation3D) ss.rotation3D = { x: 0, y: 0, z: 0 };

            ss.rotation3D.y = Number((ss.rotation3D.y + deltaX * 0.5).toFixed(2));
            ss.rotation3D.x = Number((ss.rotation3D.x + deltaY * 0.5).toFixed(2));
            clampRotationToActiveLimits(ss);

            // Update sliders
            document.getElementById('rotation-3d-y').value = ss.rotation3D.y;
            document.getElementById('rotation-3d-y-value').textContent = formatValue(ss.rotation3D.y) + '°';
            document.getElementById('rotation-3d-x').value = ss.rotation3D.x;
            document.getElementById('rotation-3d-x-value').textContent = formatValue(ss.rotation3D.x) + '°';

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
