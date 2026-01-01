// LLM Provider Configuration
// Centralized configuration for all AI translation providers and models

const llmProviders = {
    anthropic: {
        name: 'Anthropic (Claude)',
        keyPrefix: 'sk-ant-',
        storageKey: 'claudeApiKey',
        modelStorageKey: 'anthropicModel',
        models: [
            { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5 ($)' },
            { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5 ($$)' },
            { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5 ($$$)' }
        ],
        defaultModel: 'claude-sonnet-4-5-20250929'
    },
    openai: {
        name: 'OpenAI (GPT)',
        keyPrefix: 'sk-',
        storageKey: 'openaiApiKey',
        modelStorageKey: 'openaiModel',
        models: [
            { id: 'gpt-5.1-2025-11-13', name: 'GPT-5.1 ($$$)' },
            { id: 'gpt-5-mini-2025-08-07', name: 'GPT-5 Mini ($$)' },
            { id: 'gpt-5-nano-2025-08-07', name: 'GPT-5 Nano ($)' }
        ],
        defaultModel: 'gpt-5-mini-2025-08-07'
    },
    google: {
        name: 'Google (Gemini)',
        keyPrefix: 'AIza',
        storageKey: 'googleApiKey',
        modelStorageKey: 'googleModel',
        models: [
            { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite ($)' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash ($$)' },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro ($$$)' }
        ],
        defaultModel: 'gemini-2.5-flash'
    },
    ollama: {
        name: 'Ollama (Local)',
        keyPrefix: null, // No API key required
        storageKey: null, // No API key storage
        modelStorageKey: 'ollamaModel',
        urlStorageKey: 'ollamaUrl',
        defaultUrl: 'http://localhost:11434',
        models: [], // User specifies their own model
        defaultModel: 'llama3.2',
        isLocal: true
    }
};

/**
 * Get the selected model for a provider
 * @param {string} provider - Provider key (anthropic, openai, google, ollama)
 * @returns {string} - Model ID
 */
function getSelectedModel(provider) {
    const config = llmProviders[provider];
    if (!config) return null;
    return localStorage.getItem(config.modelStorageKey) || config.defaultModel;
}

/**
 * Get the Ollama base URL
 * @returns {string} - Ollama URL
 */
function getOllamaUrl() {
    return localStorage.getItem('ollamaUrl') || llmProviders.ollama.defaultUrl;
}

/**
 * Fetch available models from Ollama
 * @param {string} baseUrl - Ollama server URL (optional, uses saved URL if not provided)
 * @returns {Promise<Array>} - Array of model objects with name and size
 */
async function fetchOllamaModels(baseUrl = null) {
    const url = baseUrl || getOllamaUrl();
    try {
        const response = await fetch(`${url}/api/tags`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch models: ${response.status}`);
        }

        const data = await response.json();
        return data.models || [];
    } catch (error) {
        console.error('Error fetching Ollama models:', error);
        return [];
    }
}

/**
 * Get the selected provider
 * @returns {string} - Provider key
 */
function getSelectedProvider() {
    return localStorage.getItem('aiProvider') || 'anthropic';
}

/**
 * Get API key for a provider
 * @param {string} provider - Provider key
 * @returns {string|null} - API key or null
 */
function getApiKey(provider) {
    const config = llmProviders[provider];
    if (!config) return null;
    return localStorage.getItem(config.storageKey);
}

/**
 * Validate API key format for a provider
 * @param {string} provider - Provider key
 * @param {string} key - API key to validate
 * @returns {boolean} - Whether key format is valid
 */
function validateApiKeyFormat(provider, key) {
    const config = llmProviders[provider];
    if (!config) return false;
    return key.startsWith(config.keyPrefix);
}

/**
 * Generate HTML options for model select dropdown
 * @param {string} provider - Provider key
 * @param {string} selectedModel - Currently selected model ID (optional)
 * @returns {string} - HTML string of option elements
 */
function generateModelOptions(provider, selectedModel = null) {
    const config = llmProviders[provider];
    if (!config) return '';

    const selected = selectedModel || getSelectedModel(provider);
    return config.models.map(model =>
        `<option value="${model.id}"${model.id === selected ? ' selected' : ''}>${model.name}</option>`
    ).join('\n');
}
