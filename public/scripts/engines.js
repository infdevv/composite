// Engine initialization and management
import { availableModels, availableModelsPollinations, availableModelsG4F } from './constants.js';

// Custom engine configuration
export let customEngineConfig = {
    type: 'openai',
    endpoint: '',
    apiKey: '',
    model: '',
    nvidiaOrgId: ''
};

// Load custom engine config from localStorage
export function loadCustomEngineConfig() {
    const saved = localStorage.getItem('customEngineConfig');
    if (saved) {
        try {
            customEngineConfig = JSON.parse(saved);
            document.getElementById('custom-engine-type').value = customEngineConfig.type || 'openai';
            document.getElementById('custom-endpoint').value = customEngineConfig.endpoint || '';
            document.getElementById('custom-api-key').value = customEngineConfig.apiKey || '';
            document.getElementById('custom-model-name').value = customEngineConfig.model || '';
            document.getElementById('nvidia-org-id').value = customEngineConfig.nvidiaOrgId || '';
        } catch (e) {
            console.error('Failed to load custom engine config:', e);
        }
    }
}

// Save custom engine config
export function saveCustomEngineConfig() {
    customEngineConfig = {
        type: document.getElementById('custom-engine-type').value,
        endpoint: document.getElementById('custom-endpoint').value.trim(),
        apiKey: document.getElementById('custom-api-key').value.trim(),
        model: document.getElementById('custom-model-name').value.trim(),
        nvidiaOrgId: document.getElementById('nvidia-org-id').value.trim()
    };

    if (!customEngineConfig.endpoint) {
        alert('Please enter an API endpoint URL');
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
        window.lorebook = bareClient.fetch("https://lorebary.sophiamccarty.com/api/lorebook/load", {
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
            if (response.ok) {
                response.json().then((lorebook) => {
                    window.lorebook = lorebook;
                    console.log("Loaded lorebook: " + lorebook["lorebook"]["name"]);
                });
            } else {
                alert("Issue loading lorebook, check debug logs.");
            }
        });
    }

    // Load plugin
    if (document.getElementById("plugin-id").value != "") {
        const pluginId = document.getElementById("plugin-id").value;
        console.log("Fetching plugin:", pluginId);

        window.plugin = bareClient.fetch("https://lorebary.sophiamccarty.com/api/plugin/" + pluginId, {
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
            if (response.ok) {
                response.json().then((plugin) => {
                    window.plugin = plugin;
                    console.log("Loaded plugin: " + (plugin.meta?.name || "Unknown Plugin"));
                });
            } else {
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
    if (engineValue === "Hyper (Auto)") {
        modelSelector.disabled = true;
        modelSelector.title = "Model selection is automatic when using Hyper (Auto)";
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
    } else if (engineValue === "G4F (Cloud AI)") {
        availableModelsG4F.forEach(model => {
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
    setTimeout(function() {
        if (localStorage.getItem("engine")) {
            // Render models
            if (localStorage.getItem("engine") === "WebLLM (Local AI)") {
                document.getElementById("model").innerHTML = "";
                availableModels.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model;
                    option.textContent = model;
                    document.getElementById('model').appendChild(option);
                    console.log("Added: " + model);
                });
            } else if (localStorage.getItem("engine") === "Pollinations (Cloud AI)") {
                document.getElementById("model").innerHTML = "";
                availableModelsPollinations.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model;
                    option.textContent = model;
                    document.getElementById('model').appendChild(option);
                    console.log("Added: " + model);
                });
            } else if (localStorage.getItem("engine") === "G4F (Cloud AI)") {
                document.getElementById("model").innerHTML = "";
                availableModelsG4F.forEach(model => {
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
            }
            document.getElementById("engine").value = localStorage.getItem("engine");
        }
        if (localStorage.getItem("model")) {
            document.getElementById("model").value = localStorage.getItem("model");
        }
        if (localStorage.getItem("prefix-prompt")) {
            document.getElementById("prefix-prompt").value = localStorage.getItem("prefix-prompt");
        }
    }, 1000);
}
