// Main entry point - imports all modular scripts
import { debug } from "./scripts/constants.js";
import { setupDeviceInfo, initializeAPIKey, checkConnectivity } from "./scripts/utils.js";
import { initializeUI } from "./scripts/ui.js";
import { customEngineConfig } from "./scripts/engines.js";
import { PollinationsAI, DeepInfra } from 'https://g4f.dev/dist/js/client.js';
import * as webllm from "https://esm.run/@mlc-ai/web-llm";
import { BareClient } from 'https://esm.sh/@tomphttp/bare-client@latest';

// Initialize clients
const bareClient = new BareClient('https://gointerstellar.app/ca/');
const deepinfraclient = new DeepInfra();

// Initialize Hyper Engine (only when needed)
window.hyperInstance = null;
window.hyperCheckInterval = null;

// Initialize WebLLM engine
const engine = new webllm.MLCEngine();

// Custom engine config (exposed globally)
window.customEngineConfig = customEngineConfig;

// Expose clients globally
window.deepinfraclient = deepinfraclient;
window.webllmEngine = engine;

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
