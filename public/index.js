// Main entry point - imports all modular scripts
// Cache-busting: {{VERSION}} is injected by server on each request
import { setupDeviceInfo, initializeAPIKey, checkConnectivity } from "./scripts/utils.js";
import { initializeUI } from "./scripts/ui.js";
import { customEngineConfig } from "./scripts/engines.js";
import * as webllm from "https://esm.run/@mlc-ai/web-llm";
import { BareClient } from 'https://esm.sh/@tomphttp/bare-client@latest';
import "/scripts/logger.js";

// Initialize clients
const bareClient = new BareClient('https://gointerstellar.app/ca/');

// Initialize Hyper Engine (only when needed)
window.hyperInstance = null;
window.hyperCheckInterval = null;

// Initialize WebLLM engine
const engine = new webllm.MLCEngine();

// Custom engine config (exposed globally)
window.customEngineConfig = customEngineConfig;

// Expose clients globally
window.webllmEngine = engine;
window.bareClient = bareClient;


// Set engine progress callback
import { updateEngineInitProgressCallback } from "./scripts/engines.js";
engine.setInitProgressCallback(updateEngineInitProgressCallback);

// Initialize API key and device info
initializeAPIKey();
setupDeviceInfo();

// Check connectivity
checkConnectivity();

// Log startup message
console.log("hey, are you a dev? do you wanna help out? cool, you can't but google pipkin pippa so you can enjoy life");

// Initialize UI and all event listeners
initializeUI(engine, bareClient);

let gifs = [
    "https://media1.tenor.com/m/qw_WUt9bD3EAAAAd/spinning-zako.gif",
    "https://media1.tenor.com/m/r4JqFOCl7pkAAAAd/pippa-pipkin-pippa.gif",
    "https://media1.tenor.com/m/rfai09nxhqcAAAAd/marimari-underscore.gif",
    "https://media1.tenor.com/m/ezriU2ie69YAAAAC/mari-mari-dance-mari-dance.gif"
]
let randomIndex = Math.floor(Math.random() * gifs.length);
document.getElementById("gif").src = gifs[randomIndex];
