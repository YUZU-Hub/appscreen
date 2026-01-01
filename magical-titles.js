// Magical Titles - AI-powered title generation using vision APIs
// Analyzes app screenshots and generates marketing headlines + subheadlines

// Track if the tooltip has been shown this session
let magicalTitlesTooltipShown = false;

/**
 * Show a tooltip suggesting the Magical Titles feature
 * Called when user adds their first screenshot(s) to a project
 */
function showMagicalTitlesTooltip() {
    // Don't show if already shown this session or dismissed before
    if (magicalTitlesTooltipShown) return;
    if (localStorage.getItem('magicalTitlesTooltipDismissed')) return;

    // Don't show if no API key is configured (Ollama doesn't need one)
    const provider = getSelectedProvider();
    const providerConfig = llmProviders[provider];
    const apiKey = providerConfig.storageKey ? localStorage.getItem(providerConfig.storageKey) : null;
    if (!providerConfig.isLocal && !apiKey) return;

    magicalTitlesTooltipShown = true;

    const btn = document.getElementById('magical-titles-btn');
    if (!btn) return;

    // Make button position relative for tooltip positioning
    btn.style.position = 'relative';

    // Create tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'feature-tooltip';
    tooltip.id = 'magical-titles-tooltip';
    tooltip.innerHTML = `
        <button class="feature-tooltip-close" onclick="dismissMagicalTitlesTooltip()">×</button>
        ✨ Try AI-generated titles!
    `;

    btn.appendChild(tooltip);

    // Auto-hide after 8 seconds
    setTimeout(() => {
        dismissMagicalTitlesTooltip();
    }, 8000);
}

/**
 * Dismiss the Magical Titles tooltip
 */
function dismissMagicalTitlesTooltip() {
    const tooltip = document.getElementById('magical-titles-tooltip');
    if (tooltip) {
        tooltip.remove();
    }
    localStorage.setItem('magicalTitlesTooltipDismissed', 'true');
}

/**
 * Get the data URL for a screenshot image in a specific language
 * @param {Object} screenshot - Screenshot object from state
 * @param {string} lang - Language code to get image for
 * @returns {string|null} - Data URL or null if not found
 */
function getScreenshotDataUrl(screenshot, lang) {
    // Try specified language first
    const localized = screenshot.localizedImages?.[lang];
    if (localized?.src) return localized.src;

    // Fallback to first available language
    for (const l of state.projectLanguages) {
        if (screenshot.localizedImages?.[l]?.src) {
            return screenshot.localizedImages[l].src;
        }
    }

    return null;
}

/**
 * Parse a data URL into its components
 * @param {string} dataUrl - Data URL string
 * @returns {Object} - { mimeType, base64 }
 */
function parseDataUrl(dataUrl) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return {
        mimeType: match[1],
        base64: match[2]
    };
}

/**
 * Generate titles using Anthropic Claude vision API
 * @param {string} apiKey - Anthropic API key
 * @param {Array} images - Array of { mimeType, base64 } objects
 * @param {string} prompt - Text prompt
 * @returns {Promise<string>} - Response text
 */
async function generateTitlesWithAnthropic(apiKey, images, prompt) {
    const model = getSelectedModel('anthropic');

    // Build content array with images first, then text
    const content = [];

    for (const img of images) {
        content.push({
            type: "image",
            source: {
                type: "base64",
                media_type: img.mimeType,
                data: img.base64
            }
        });
    }

    content.push({ type: "text", text: prompt });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
            model: model,
            max_tokens: 4096,
            messages: [{ role: "user", content: content }]
        })
    });

    if (!response.ok) {
        const status = response.status;
        const errorBody = await response.json().catch(() => ({}));
        console.error('Anthropic Vision API Error:', { status, model, error: errorBody });
        if (status === 401 || status === 403) throw new Error('AI_UNAVAILABLE');
        throw new Error(`API request failed: ${status} - ${errorBody.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return data.content[0].text;
}

/**
 * Generate titles using OpenAI GPT vision API
 * @param {string} apiKey - OpenAI API key
 * @param {Array} images - Array of { mimeType, base64 } objects
 * @param {string} prompt - Text prompt
 * @returns {Promise<string>} - Response text
 */
async function generateTitlesWithOpenAI(apiKey, images, prompt) {
    const model = getSelectedModel('openai');

    // Build content array with images and text
    const content = [];

    for (const img of images) {
        content.push({
            type: "image_url",
            image_url: {
                url: `data:${img.mimeType};base64,${img.base64}`
            }
        });
    }

    content.push({ type: "text", text: prompt });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            max_completion_tokens: 4096,
            messages: [{ role: "user", content: content }]
        })
    });

    if (!response.ok) {
        const status = response.status;
        const errorBody = await response.json().catch(() => ({}));
        console.error('OpenAI Vision API Error:', { status, model, error: errorBody });
        if (status === 401 || status === 403) throw new Error('AI_UNAVAILABLE');
        throw new Error(`API request failed: ${status} - ${errorBody.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

/**
 * Generate titles using Google Gemini vision API
 * @param {string} apiKey - Google API key
 * @param {Array} images - Array of { mimeType, base64 } objects
 * @param {string} prompt - Text prompt
 * @returns {Promise<string>} - Response text
 */
async function generateTitlesWithGoogle(apiKey, images, prompt) {
    const model = getSelectedModel('google');

    // Build parts array with images and text
    const parts = [];

    for (const img of images) {
        parts.push({
            inlineData: {
                mimeType: img.mimeType,
                data: img.base64
            }
        });
    }

    parts.push({ text: prompt });

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            contents: [{ parts: parts }]
        })
    });

    if (!response.ok) {
        const status = response.status;
        const errorBody = await response.json().catch(() => ({}));
        console.error('Google Vision API Error:', { status, model, error: errorBody });
        if (status === 401 || status === 403 || status === 400) throw new Error('AI_UNAVAILABLE');
        throw new Error(`API request failed: ${status} - ${errorBody.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

/**
 * Generate titles using Ollama local API
 * Note: Requires a vision-capable model like llava, llava-llama3, bakllava, etc.
 * @param {Array} images - Array of { mimeType, base64 } objects
 * @param {string} prompt - Text prompt
 * @returns {Promise<string>} - Response text
 */
async function generateTitlesWithOllama(images, prompt) {
    const model = getSelectedModel('ollama');
    const baseUrl = getOllamaUrl();

    // Ollama uses the /api/chat endpoint with images array
    const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: model,
            messages: [{
                role: "user",
                content: prompt,
                images: images.map(img => img.base64)
            }],
            stream: false
        })
    });

    if (!response.ok) {
        const status = response.status;
        const errorBody = await response.json().catch(() => ({}));
        console.error('Ollama Vision API Error:', { status, model, error: errorBody });
        if (status === 404) throw new Error('OLLAMA_MODEL_NOT_FOUND');
        throw new Error(`Ollama request failed: ${status}. Make sure Ollama is running and you have a vision model.`);
    }

    const data = await response.json();
    return data.message.content;
}

/**
 * Show the magical titles confirmation dialog
 */
function showMagicalTitlesDialog() {
    // Validate screenshots exist
    if (!state.screenshots || state.screenshots.length === 0) {
        showAppAlert('Please add some screenshots first.', 'info');
        return;
    }

    // Get provider and API key
    const provider = getSelectedProvider();
    const providerConfig = llmProviders[provider];
    const apiKey = providerConfig.storageKey ? localStorage.getItem(providerConfig.storageKey) : null;

    // Ollama doesn't need an API key, other providers do
    if (!providerConfig.isLocal && !apiKey) {
        showAppAlert('Please configure your AI API key in Settings first.', 'error');
        return;
    }

    // Update modal info
    document.getElementById('magical-titles-count').textContent = state.screenshots.length;
    document.getElementById('magical-titles-provider').textContent = providerConfig.name;

    // Populate language dropdown
    const langSelect = document.getElementById('magical-titles-language');
    langSelect.innerHTML = state.projectLanguages.map(lang => {
        const langName = languageNames[lang] || lang;
        return `<option value="${lang}">${langName}</option>`;
    }).join('');

    // Show modal
    document.getElementById('magical-titles-modal').classList.add('visible');
}

/**
 * Hide the magical titles confirmation dialog
 */
function hideMagicalTitlesDialog() {
    document.getElementById('magical-titles-modal').classList.remove('visible');
}

/**
 * Main function to generate magical titles for all screenshots
 */
async function generateMagicalTitles() {
    // Hide the confirmation dialog
    hideMagicalTitlesDialog();

    // Get provider and API key
    const provider = getSelectedProvider();
    const providerConfig = llmProviders[provider];
    const apiKey = localStorage.getItem(providerConfig.storageKey);

    // Get selected language from dropdown
    const langSelect = document.getElementById('magical-titles-language');
    const sourceLang = langSelect.value || state.projectLanguages[0] || 'en';
    const langName = languageNames[sourceLang] || 'English';

    // Collect images from all screenshots
    const images = [];
    for (const screenshot of state.screenshots) {
        const dataUrl = getScreenshotDataUrl(screenshot, sourceLang);
        if (dataUrl) {
            const parsed = parseDataUrl(dataUrl);
            if (parsed) {
                images.push(parsed);
            }
        }
    }

    if (images.length === 0) {
        await showAppAlert('No screenshot images found. Please upload some screenshots first.', 'error');
        return;
    }

    // Build prompt
    const prompt = `You are an expert App Store marketing copywriter. Analyze these ${images.length} app screenshots and create compelling marketing titles.

The screenshots are shown in order (1 through ${images.length}). Study what the app does and identify:
1. The main purpose and value proposition
2. The user problem it solves
3. Key features visible in each screen

CRITICAL: Screenshot 1's headline MUST focus on the main value proposition - what problem does this app solve for users? This is the most important title.

LENGTH REQUIREMENTS - THIS IS VERY IMPORTANT:
- headline: VERY SHORT, maximum 2-4 words. Punchy, memorable, benefit-focused.
- subheadline: SHORT, maximum 4-8 words. Expands on the headline.

UNIQUENESS - VERY IMPORTANT:
- Each screenshot MUST have a UNIQUE headline and subheadline
- Do NOT repeat or reuse similar titles across screenshots
- Each title should highlight a DIFFERENT feature or benefit

Examples of good headlines: "Track Every Expense", "Sleep Better Tonight", "Never Forget Again"
Examples of good subheadlines: "Automatic expense categorization and insights", "Science-backed sleep improvement", "Smart reminders that actually work"

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
    "0": { "headline": "...", "subheadline": "..." },
    "1": { "headline": "...", "subheadline": "..." }
}

Where the keys are 0-indexed screenshot numbers.
Write all titles in ${langName}.`;

    // Create progress overlay
    const progressOverlay = document.createElement('div');
    progressOverlay.id = 'magical-titles-progress';
    progressOverlay.innerHTML = `
        <div class="modal-overlay visible">
            <div class="modal">
                <div class="modal-icon" style="background: linear-gradient(135deg, rgba(255, 215, 0, 0.2) 0%, rgba(255, 140, 0, 0.2) 100%);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #ffa500; animation: spin 2s linear infinite;">
                        <path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7-6.3-4.6L5.7 21l2.3-7-6-4.6h7.6z"/>
                    </svg>
                </div>
                <h3 class="modal-title">Generating Magical Titles...</h3>
                <p id="magical-titles-status" style="color: var(--text-secondary); margin-top: 8px;">Analyzing ${images.length} screenshots with AI...</p>
                <p id="magical-titles-detail" style="color: var(--text-tertiary); font-size: 12px; margin-top: 4px;">Using ${providerConfig.name}</p>
            </div>
        </div>
    `;
    document.body.appendChild(progressOverlay);

    const updateStatus = (text, detail = '') => {
        const statusEl = document.getElementById('magical-titles-status');
        const detailEl = document.getElementById('magical-titles-detail');
        if (statusEl) statusEl.textContent = text;
        if (detailEl) detailEl.textContent = detail;
    };

    try {
        // Call provider-specific API
        let responseText;

        updateStatus('Sending screenshots to AI...', `${images.length} images to analyze`);

        if (provider === 'anthropic') {
            responseText = await generateTitlesWithAnthropic(apiKey, images, prompt);
        } else if (provider === 'openai') {
            responseText = await generateTitlesWithOpenAI(apiKey, images, prompt);
        } else if (provider === 'google') {
            responseText = await generateTitlesWithGoogle(apiKey, images, prompt);
        } else if (provider === 'ollama') {
            responseText = await generateTitlesWithOllama(images, prompt);
        } else {
            throw new Error(`Unknown provider: ${provider}`);
        }

        updateStatus('Processing response...', 'Parsing generated titles');

        // Clean up response - remove markdown code blocks if present
        responseText = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

        // Extract JSON object from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            responseText = jsonMatch[0];
        }

        console.log('Magical Titles response:', responseText);

        // Parse JSON
        const titles = JSON.parse(responseText);

        updateStatus('Applying titles...', 'Updating screenshots');

        // Apply titles to screenshots
        for (let i = 0; i < state.screenshots.length; i++) {
            const titleData = titles[String(i)];
            if (titleData) {
                const screenshot = state.screenshots[i];

                // Ensure text object exists with proper structure
                if (!screenshot.text) {
                    screenshot.text = {
                        headlines: {},
                        subheadlines: {}
                    };
                }
                if (!screenshot.text.headlines) screenshot.text.headlines = {};
                if (!screenshot.text.subheadlines) screenshot.text.subheadlines = {};

                // Set the titles for the source language
                if (titleData.headline) {
                    screenshot.text.headlines[sourceLang] = titleData.headline;
                }
                if (titleData.subheadline) {
                    screenshot.text.subheadlines[sourceLang] = titleData.subheadline;
                }
            }
        }

        // Update UI
        syncUIWithState();
        updateCanvas();
        saveState();

        // Remove progress overlay
        progressOverlay.remove();

        // Show success message
        await showAppAlert(`Generated titles for ${Object.keys(titles).length} screenshots in ${langName}!`, 'success');

    } catch (error) {
        console.error('Magical Titles error:', error);
        progressOverlay.remove();

        if (error.message === 'AI_UNAVAILABLE') {
            await showAppAlert('AI service unavailable. Please check your API key in Settings.', 'error');
        } else if (error.message === 'OLLAMA_MODEL_NOT_FOUND') {
            await showAppAlert('Model not found. Pull it with: ollama pull <model-name>', 'error');
        } else if (error.message === 'Failed to fetch') {
            const provider = getSelectedProvider();
            if (provider === 'ollama') {
                await showAppAlert('Cannot connect to Ollama. Make sure it is running.', 'error');
            } else {
                await showAppAlert('Connection failed. Please check your internet connection.', 'error');
            }
        } else if (error instanceof SyntaxError) {
            await showAppAlert('Failed to parse AI response. Please try again.', 'error');
        } else {
            await showAppAlert(`Error generating titles: ${error.message}`, 'error');
        }
    }
}
