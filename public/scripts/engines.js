// Engine initialization and management
import { availableModels, availableModelsGemini, availableModelsPollinations, availableModelsYuzu } from './constants.js';

// Custom engine configuration
export let customEngineConfig = {
    type: 'openai',
    endpoint: '',
    apiKey: '',
    model: ''
};

// Load custom engine config from localStorage
export function loadCustomEngineConfig() {
    const saved = localStorage.getItem('customEngineConfig');
    console.log('loadCustomEngineConfig called');
    console.log('  localStorage has data:', !!saved);

    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            console.log('  Parsed config:', parsed);

            // Update properties instead of reassigning to maintain reference
            customEngineConfig.type = parsed.type || 'openai';
            customEngineConfig.endpoint = parsed.endpoint || '';
            customEngineConfig.apiKey = parsed.apiKey || '';
            customEngineConfig.model = parsed.model || '';

            console.log('  Updated customEngineConfig object:', customEngineConfig);

            // Only update DOM elements if they exist
            const typeEl = document.getElementById('custom-engine-type');
            const endpointEl = document.getElementById('custom-endpoint');
            const apiKeyEl = document.getElementById('custom-api-key');
            const modelEl = document.getElementById('custom-model-name');

            if (typeEl) typeEl.value = customEngineConfig.type;
            if (endpointEl) endpointEl.value = customEngineConfig.endpoint;
            if (apiKeyEl) apiKeyEl.value = customEngineConfig.apiKey;
            if (modelEl) modelEl.value = customEngineConfig.model;

            console.log('  DOM elements updated:', {
                typeEl: !!typeEl,
                endpointEl: !!endpointEl,
                apiKeyEl: !!apiKeyEl,
                modelEl: !!modelEl
            });
        } catch (e) {
            console.error('Failed to load custom engine config:', e);
        }
    } else {
        console.log('  No saved config found in localStorage');
        console.log('  Current customEngineConfig:', customEngineConfig);
    }
}

// Save custom engine config
export function saveCustomEngineConfig() {
    // Get and validate values BEFORE updating the config object
    const type = document.getElementById('custom-engine-type').value;
    const endpoint = document.getElementById('custom-endpoint').value.trim();
    const apiKey = document.getElementById('custom-api-key').value.trim();
    const model = document.getElementById('custom-model-name').value.trim();

    // Validate required fields first
    if (!endpoint) {
        alert('Please enter an API endpoint URL');
        return;
    }

    if (!model) {
        alert('Please enter a model name');
        return;
    }

    // Only update the config object after validation passes
    customEngineConfig.type = type;
    customEngineConfig.endpoint = endpoint;
    customEngineConfig.apiKey = apiKey;
    customEngineConfig.model = model;

    // Save to localStorage
    localStorage.setItem('customEngineConfig', JSON.stringify(customEngineConfig));

    console.log('Custom engine configuration saved successfully:', customEngineConfig);
    console.log('Saved to localStorage:', localStorage.getItem('customEngineConfig'));
    alert('Custom engine configuration saved successfully!');

    // Update model dropdown
    document.getElementById('model').innerHTML = '';
    const option = document.createElement('option');
    option.value = customEngineConfig.model;
    option.textContent = customEngineConfig.model;
    document.getElementById('model').appendChild(option);
}

// Initialize WebLLM Engine
export async function initializeWebLLMEngine(engine) {
    let selectedModel = document.getElementById("model").value;

    // compute dynamic length

    let memory = navigator.deviceMemory;
    let context_len = 30000;

    context_len = Math.min(128000, 90000 + (memory - 4) * 10000);

    const config = {
        temperature: 0.7,
        top_p: 1,
        context_window_size: context_len,
    };
    await engine.reload(selectedModel, config);
}

// Update engine init progress
export function updateEngineInitProgressCallback(report) {
    console.info("initialize", report.progress);
    document.getElementById("start").innerHTML = report.text;
}


// Load models and start engine
export async function load(engine, bareClient) {

    console.log("clicked");
    document.getElementById("start").innerHTML = "Loading...";
    document.getElementById("start").disabled = true;

    if (document.getElementById("engine").value != "WebLLM (Local AI)") {
        document.getElementById("start").innerHTML = "Started";
    } else {
        try {
            await initializeWebLLMEngine(engine);
            document.getElementById("start").innerHTML = "Started";
            document.getElementById("start").disabled = false;
        } catch (e) {
            console.error(e);
            document.getElementById("start").innerHTML = "Error, check logs";
            document.getElementById("start").disabled = false;
        }
    }
}

// Initialize default models on page load
export function initializeDefaultModels() {
    document.addEventListener('DOMContentLoaded', async function() {
        const defaultEngine = document.getElementById("engine").value;
        const modelSelector = document.getElementById("model");

        if (defaultEngine === "Hyper (Auto)") {
            modelSelector.disabled = true;
            modelSelector.title = "Model selection is automatic when using Hyper (Auto)";

            if (!window.hyperInstance) {
                window.hyperInstance = new Hyper();
                console.log("Hyper Engine initialized on page load");
            }

            if (!window.hyperCheckInterval) {
                console.log("Running initial Hyper autoCheck...");
                await window.hyperInstance.autoCheck();
                window.hyperCheckInterval = setInterval(() => window.hyperInstance.autoCheck(), 1000 * 160);
                console.log("Hyper autochecks started");
            }

            window.hyperInstance.models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                document.getElementById('model').appendChild(option);
                console.log("Added Hyper model: " + model);
            });
        } else if (defaultEngine === "WebLLM (Local AI)") {
            availableModels.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                document.getElementById('model').appendChild(option);
                console.log("Added default: " + model);
            });
        } else if (defaultEngine === "Google Gemini") {
            availableModelsGemini.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                document.getElementById('model').appendChild(option);
                console.log("Added Gemini default: " + model);
            });
        }
    });
}

// Handle engine selection changes
export function handleEngineChange() {
    document.getElementById("model").innerHTML = "";
    const engineValue = document.getElementById("engine").value;
    const customConfigDiv = document.getElementById("custom-engine-config");
    const modelSelector = document.getElementById("model");

    // Stop Hyper autochecks if switching away from Hyper
    if (engineValue !== "Hyper (Auto)" && window.hyperCheckInterval) {
        clearInterval(window.hyperCheckInterval);
        window.hyperCheckInterval = null;
    }

    // Disable/enable model selector based on engine
    if (engineValue === "Hyper (Auto)" || engineValue === "Yuzu (AUTO)") {
        modelSelector.disabled = true;
        modelSelector.title = engineValue === "Hyper (Auto)"
            ? "Model selection is automatic when using Hyper (Auto)"
            : "Model selection is automatic when using Yuzu (AUTO)";
    } else {
        modelSelector.disabled = false;
        modelSelector.title = "";
    }

    // Show/hide custom engine configuration
    if (engineValue === "Custom Engine") {
        customConfigDiv.style.display = "block";
        loadCustomEngineConfig();
        if (customEngineConfig.model) {
            const option = document.createElement('option');
            option.value = customEngineConfig.model;
            option.textContent = customEngineConfig.model;
            document.getElementById('model').appendChild(option);
        }
    } else {
        customConfigDiv.style.display = "none";
    }

    // Populate models based on engine
    if (engineValue === "WebLLM (Local AI)") {
        availableModels.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            document.getElementById('model').appendChild(option);
            console.log("Added: " + model);
        });
    } else if (engineValue === "Pollinations (Cloud AI)") {
        availableModelsPollinations.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            document.getElementById('model').appendChild(option);
            console.log("Added: " + model);
        });
    } else if (engineValue === "Yuzu (Cloud AI)") {
        availableModelsYuzu.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            if (model.includes(":")) {
                option.textContent = model.split(":")[1];
            } else {
                option.textContent = model;
            }
            document.getElementById('model').appendChild(option);
            console.log("Added: " + model);
        });
    } else if (engineValue === "Yuzu (AUTO)") {
        const option = document.createElement('option');
        option.value = "auto";
        option.textContent = "Automatic Model Selection";
        document.getElementById('model').appendChild(option);
        console.log("Added: Yuzu AUTO mode");
    } else if (engineValue === "Hyper (Auto)") {
        if (!window.hyperInstance) {
            window.hyperInstance = new Hyper();
            console.log("Hyper Engine initialized");
        }

        if (!window.hyperCheckInterval) {
            window.hyperInstance.autoCheck();
            window.hyperCheckInterval = setInterval(() => window.hyperInstance.autoCheck(), 1000 * 160);
            console.log("Hyper autochecks started");
        }

        window.hyperInstance.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            document.getElementById('model').appendChild(option);
            console.log("Added: " + model);
        });
    } else if (engineValue === "Google Gemini") {
        availableModelsGemini.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            document.getElementById('model').appendChild(option);
            console.log("Added Gemini model: " + model);
        });
    }
}

// Load saved config from localStorage
export function loadSavedConfig() {
    // Track if user has manually changed the engine
    let userChangedEngine = false;

    // Listen for manual engine changes
    const engineSelect = document.getElementById("engine");
    if (engineSelect) {
        engineSelect.addEventListener("change", () => {
            userChangedEngine = true;
            console.log("User manually changed engine, will not override with saved config");
        });
    }

    setTimeout(function() {
        if (localStorage.getItem("engine")) {
            // Only restore saved engine if user hasn't manually changed it
            const savedEngine = localStorage.getItem("engine");

            if (!userChangedEngine && savedEngine != "Google Gemini") {
                console.log("Restoring saved engine:", savedEngine);
                document.getElementById("engine").value = savedEngine;

                // Trigger the engine change handler to populate models correctly
                handleEngineChange();
            } else {
                console.log("User changed engine, not restoring saved engine:", savedEngine);
            }
        }

        if (localStorage.getItem("model")) {
            document.getElementById("model").value = localStorage.getItem("model");
        }
        if (localStorage.getItem("prefix-prompt")) {
            document.getElementById("prefix-prompt").value = localStorage.getItem("prefix-prompt");
        }
    }, 1000);
}
