// Engine initialization and management
import { availableModels, availableModelsPollinations, availableModelsYuzu } from './constants.js';

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
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            // Update properties instead of reassigning to maintain reference
            customEngineConfig.type = parsed.type || 'openai';
            customEngineConfig.endpoint = parsed.endpoint || '';
            customEngineConfig.apiKey = parsed.apiKey || '';
            customEngineConfig.model = parsed.model || '';

            document.getElementById('custom-engine-type').value = customEngineConfig.type;
            document.getElementById('custom-endpoint').value = customEngineConfig.endpoint;
            document.getElementById('custom-api-key').value = customEngineConfig.apiKey;
            document.getElementById('custom-model-name').value = customEngineConfig.model;
        } catch (e) {
            console.error('Failed to load custom engine config:', e);
        }
    }
}

// Save custom engine config
export function saveCustomEngineConfig() {
    // Update properties instead of reassigning to maintain reference
    customEngineConfig.type = document.getElementById('custom-engine-type').value;
    customEngineConfig.endpoint = document.getElementById('custom-endpoint').value.trim();
    customEngineConfig.apiKey = document.getElementById('custom-api-key').value.trim();
    customEngineConfig.model = document.getElementById('custom-model-name').value.trim();

    if (!customEngineConfig.endpoint) {
        alert('Please enter an API endpoint URL');
        return;
    }

    if (!customEngineConfig.model) {
        alert('Please enter a model name');
        return;
    }

    localStorage.setItem('customEngineConfig', JSON.stringify(customEngineConfig));
    alert('Custom engine configuration saved!');
    console.log('Custom engine config saved:', customEngineConfig);

    document.getElementById('model').innerHTML = '';
    const option = document.createElement('option');
    option.value = customEngineConfig.model || 'custom-model';
    option.textContent = customEngineConfig.model || 'Custom Model';
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

// Load lorebook and plugin
export async function loadLorebookAndPlugin(bareClient) {
    window.lorebook = null;
    window.plugin = null;
    window.pluginParser = new PluginParser();

    // Load lorebook
    if (document.getElementById("lorebook-id").value != "") {
        const lorebookUrl = "https://lorebary.sophiamccarty.com/api/lorebook/load";
        console.log("Fetching lorebook via bare client:", lorebookUrl);

        window.lorebook = bareClient.fetch(lorebookUrl, {
            "headers": {
                "accept": "*/*",
                "accept-language": "en-US,en;q=0.5",
                "content-type": "application/json",
                "origin": "big poe",
                "priority": "u=1, i",
            },
            "body": "{\"code\":\"" + document.getElementById("lorebook-id").value + "\"}",
            "method": "POST",
            "mode": "cors",
            "credentials": "include"
        });

        window.lorebook.then((response) => {
            console.log("Lorebook response status:", response.status, response.statusText);
            console.log("Lorebook response URL:", response.url);
            if (response.ok) {
                response.json().then((lorebook) => {
                    window.lorebook = lorebook;
                    console.log("Loaded lorebook: " + lorebook["lorebook"]["name"]);
                });
            } else {
                console.error("Lorebook fetch failed with status:", response.status);
                response.text().then(text => console.error("Response body:", text));
                alert("Issue loading lorebook, check debug logs.");
            }
        }).catch((error) => {
            console.error("Error fetching lorebook:", error);
            alert("Error fetching lorebook: " + error.message);
        });
    }

    // Load plugin
    if (document.getElementById("plugin-id").value != "") {
        const pluginId = document.getElementById("plugin-id").value;
        const pluginUrl = "https://lorebary.sophiamccarty.com/api/plugin/" + pluginId;
        console.log("Fetching plugin via bare client:", pluginUrl);

        window.plugin = bareClient.fetch(pluginUrl, {
            "headers": {
                "accept": "*/*",
                "accept-language": "en-US,en;q=0.5",
                "priority": "u=1, i",
                "sec-ch-ua": '"Chromium";v="140", "Not=A?Brand";v="24", "Brave";v="140"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
                "sec-gpc": "1"
            },
            "method": "GET",
            "mode": "cors",
            "credentials": "include"
        });

        window.plugin.then((response) => {
            console.log("Plugin response status:", response.status, response.statusText);
            console.log("Plugin response URL:", response.url);
            if (response.ok) {
                response.json().then((plugin) => {
                    window.plugin = plugin;
                    console.log("Loaded plugin: " + (plugin.meta?.name || "Unknown Plugin"));
                });
            } else {
                console.error("Plugin fetch failed with status:", response.status);
                response.text().then(text => console.error("Response body:", text));
                console.error("Issue loading plugin, check debug logs.");
                alert("Issue loading plugin, check debug logs.");
            }
        }).catch((error) => {
            console.error("Error fetching plugin:", error);
            alert("Error fetching plugin: " + error.message);
        });
    }
}

// Load models and start engine
export async function load(engine, bareClient) {
    await loadLorebookAndPlugin(bareClient);

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

            if (!userChangedEngine) {
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
