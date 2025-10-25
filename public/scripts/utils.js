
import { debug } from './constants.js';

function setupDeviceInfo() {
    document.getElementById("browser").innerHTML = navigator.userAgent + " " + navigator.platform;
    document.getElementById("memory").innerHTML = navigator.deviceMemory;
}

function initializeAPIKey() {
    let apiKey = localStorage.getItem("id");
    if (apiKey) {
        document.getElementById("key").innerHTML = apiKey;
    } else {
        let id = crypto.randomUUID();
        localStorage.setItem("id", id);
        document.getElementById("key").innerHTML = id;
    }
}

async function checkConnectivity() {
    if (!debug) {
        // Check HuggingFace
        try {
            fetch("https://huggingface.co/LucidityAI/Synth-2/raw/main/config.json").then(res => {
                if (res.ok) {
                    document.getElementById("hf").style.color = "#74db7a";
                }
            });
        } catch {
            document.getElementById("hf").style.color = "red";
        }

        // Check Yuzu/DeepInfra
        try {
            fetch("https://api.deepinfra.com/v1/openai/chat/completions").then(res => {
                if (res.status == 405) {
                    document.getElementById("yuzu").style.color = "#74db7a";
                }
            });
        } catch {
            document.getElementById("yuzu").style.color = "red";
        }

        // Check health endpoint
        try {
            fetch("/health").then(res => {
                if (res.ok) {
                    document.getElementById("health").style.color = "#74db7a";
                }
            });
        } catch {
            document.getElementById("health").style.color = "red";
        }

        // Check Pollinations
        try {
            fetch("https://text.pollinations.ai/wsg").then(res => {
                if (res.ok) {
                    document.getElementById("pollinations").style.color = "#74db7a";
                }
            });
        } catch {
            document.getElementById("pollinations").style.color = "red";
        }
    }
}

// Prompt preset descriptions
export const promptDescriptions = {
    "none": "No prompt modifications - AI will behave with default settings",
    "smolrp": "Adaptive roleplay with authentic characters, 300-550+ words, cinematic composition. Focuses on genuine engagement over perfection.",
    "slop": "Adds common romance novel phrases like 'mind, body and soul' and 'ruin you for anyone else' excessively throughout responses",
    "unpositive": "Removes positivity from roleplay, focuses on darker/grimmer tones and themes",
    "dacm": "Strong RP prompt",
    "infdev": "Dynamic RP prompt",
    "affection": "Maximum affection mode - AI becomes extremely loving and affectionate regardless of character personality",
    "cheese": "First-person POV, extremely explicit 18+ smut writing, detailed combat scenes, strong character development focus",
    "pupi": "700-word max responses, third-person narrative, cinematic prose with slow-paced storytelling and psychological depth",
    "teto": "AI becomes obsessed with Kasane Teto regardless of your input. For memes only."
};

// Update prompt description display
function updatePromptDescription() {
    const selectedValue = document.getElementById("prefix-prompt").value;
    const descriptionDiv = document.getElementById("prompt-description");
    descriptionDiv.textContent = promptDescriptions[selectedValue] || "Hover over options to see descriptions";
}
function proxyFetch(url, options = {}) {
    const proxyChecked = document.getElementById("turn-on-proxy")?.checked;
    if (proxyChecked) {
        try {
            const originalUrl = new URL(url);
            const proxyUrl = `https://offshore.seabase.xyz/${originalUrl.host}${originalUrl.pathname}${originalUrl.search}`;
            return fetch(proxyUrl, options);
        } catch (e) {
            console.error("Proxy URL construction failed:", e);
            return fetch(url, options);
        }
    } else {
        return fetch(url, options);
    }
}


export { setupDeviceInfo, initializeAPIKey, checkConnectivity, updatePromptDescription, proxyFetch };