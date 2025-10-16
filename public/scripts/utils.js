// Utility functions and helpers
import { debug } from './constants.js';

// Setup device info display
export function setupDeviceInfo() {
    document.getElementById("browser").innerHTML = navigator.userAgent + " " + navigator.platform;
    document.getElementById("memory").innerHTML = navigator.deviceMemory;
}

// Initialize API key
export function initializeAPIKey() {
    let apiKey = localStorage.getItem("id");
    if (apiKey) {
        document.getElementById("key").innerHTML = apiKey;
    } else {
        let id = crypto.randomUUID();
        localStorage.setItem("id", id);
        document.getElementById("key").innerHTML = id;
    }
}

// Check connectivity to various services
export async function checkConnectivity() {
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

        // Check G4F/DeepInfra
        try {
            fetch("https://api.deepinfra.com/v1/openai/chat/completions").then(res => {
                if (res.status == 405) {
                    document.getElementById("g4f").style.color = "#74db7a";
                }
            });
        } catch {
            document.getElementById("g4f").style.color = "red";
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
    "affection": "Maximum affection mode - AI becomes extremely loving and affectionate regardless of character personality",
    "cheese": "First-person POV, extremely explicit 18+ smut writing, detailed combat scenes, strong character development focus",
    "Pupi's Prompt": "700-word max responses, third-person narrative, cinematic prose with slow-paced storytelling and psychological depth",
    "teto": "AI becomes obsessed with Kasane Teto regardless of your input. For memes only."
};

// Update prompt description display
export function updatePromptDescription() {
    const selectedValue = document.getElementById("prefix-prompt").value;
    const descriptionDiv = document.getElementById("prompt-description");
    descriptionDiv.textContent = promptDescriptions[selectedValue] || "Hover over options to see descriptions";
}
