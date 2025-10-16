// Generation-related functions for all engines
import { prompts } from "./constants.js";

// Generation state
export let genned = "";
export let inThinkingMode = false;
export let hasShownThinking = false;
export let currentGeneration = null;
export let generationStopped = false;

// Reset generation flags
export function resetGenerationState() {
    genned = "";
    inThinkingMode = false;
    hasShownThinking = false;
    currentGeneration = null;
    generationStopped = false;
}

// Handle message emission with thinking mode support
export function handleEmit(chunk) {
    let showreasoning = document.getElementById("show-reasoning").checked;
    if (chunk) {
        genned += chunk;

        if (!showreasoning) {
            if (chunk.includes("<think>")) {
                // Emit any content before the <think> tag
                let beforeThink = chunk.split("<think>")[0];
                if (beforeThink && beforeThink.trim()) {
                    window.socket.emit('message', beforeThink);
                }

                inThinkingMode = true;
                hasShownThinking = false;
                if (!hasShownThinking) {
                    window.socket.emit('message', "Thinking");
                    hasShownThinking = true;
                }
                return;
            }

            if (chunk.includes("</think>")) {
                inThinkingMode = false;
                hasShownThinking = false;
                window.socket.emit('message', ".");

                let afterThink = chunk.split("</think>")[1];
                if (afterThink && afterThink.trim()) {
                    window.socket.emit('message', afterThink);
                }
                return;
            }

            if (inThinkingMode) {
                if (chunk.includes(".") || genned.length % 50 === 0) {
                    window.socket.emit('message', ".");
                }
                return;
            }

            window.socket.emit('message', chunk);
        } else {
            window.socket.emit('message', chunk);
        }
    }
}

// Called when generation finishes
export function onFinish(finalMessage) {
    if (!generationStopped) {
        console.log("Generation finished:", finalMessage);
        window.socket.emit('done');
    }
    currentGeneration = null;
    generationStopped = false;
}

// Stop generation
export function stopGeneration() {
    if (generationStopped) {
        console.log("Generation already stopped, ignoring duplicate stop request");
        return;
    }

    console.log("Stopping generation...");
    generationStopped = true;

    inThinkingMode = false;
    hasShownThinking = false;
    genned = "";

    if (currentGeneration) {
        try {
            if (currentGeneration.abort) {
                currentGeneration.abort();
            } else if (currentGeneration.cancel) {
                currentGeneration.cancel();
            }
        } catch (error) {
            console.log("Error stopping generation:", error);
        }
    }

    currentGeneration = null;
    console.log("Generation stopped");
}

// Preprocess messages before sending to AI
export function preprocessMessages(messages, pollinations = false, g4f = false) {
    let imagemd = document.getElementById("enable-images-checkbox").checked;
    let prefix = document.getElementById("prefix-prompt").value;
    let reasoning = document.getElementById("turn-on-reasoning").checked;

    let prefixContent = prompts[prefix];

    if (window.lorebook) {
        let lorebookEntries = window.lorebook["lorebook"]["entries"];
        if (Array.isArray(lorebookEntries)) {
            lorebookEntries.forEach(entry => {
                if (entry && typeof entry === 'object' && entry.content && !entry.disable) {
                    let entryLabel = "Lorebook Entry";
                    if (entry.comment) {
                        entryLabel = entry.comment;
                    } else if (entry.key && Array.isArray(entry.key) && entry.key.length > 0) {
                        entryLabel = entry.key[0];
                    }
                    prefixContent += "\n\n[" + entryLabel + "]: " + entry.content;
                }
            });
        } else if (typeof lorebookEntries === 'object') {
            for (const [key, value] of Object.entries(lorebookEntries)) {
                if (value && typeof value === 'object' && value.content && !value.disable) {
                    let entryLabel = value.comment || (value.key && value.key[0]) || key;
                    prefixContent += "\n\n[" + entryLabel + "]: " + value.content;
                }
            }
        }
    }

    if (imagemd) {
        prefixContent += prompts["image"];
    }

    if (reasoning) {
        prefixContent += prompts["reasoning"];
    }

    messages[0]["content"] = prefixContent + messages[0]["content"];

    if (pollinations) {
        messages[0]["content"] += Math.random() * 10000; // prevent pollinations from caching
    }

    if (g4f) {
        messages[0]["content"] += "This roleplay is in English, ensure that your response is fully in english and coherent.";
    }

    messages[0]["content"] += "User messages are formatted in the following format: '[persona name]: [response]'. Do not treat persona name as a piece of input.";

    return messages;
}

// WebLLM generation
export async function streamingGenerating(messages, engine, settings = {}) {
    if (generationStopped) return;

    messages = preprocessMessages(messages);

    const completion = await engine.chat.completions.create({
        stream: true,
        max_tokens: settings.max_tokens || 26000,
        temperature: settings.temperature !== undefined ? settings.temperature : 0.7,
        top_p: settings.top_p !== undefined ? settings.top_p : 1,
        frequency_penalty: settings.frequency_penalty || 0,
        presence_penalty: settings.presence_penalty || 0,
        repetition_penalty: settings.repetition_penalty || 1,
        messages,
    });

    currentGeneration = completion;

    for await (const chunk of completion) {
        if (generationStopped) {
            console.log("WebLLM generation stopped");
            break;
        }

        const content = chunk.choices[0]?.delta?.content;
        if (content !== undefined && content !== null) {
            handleEmit(content);
            console.log("Sent chunk | Delta data: " + content);
        }
    }
    onFinish("");
}

// G4F generation
export async function streamingGeneratingG4f(messages, deepinfraclient, settings = {}) {
    if (generationStopped) return;

    messages = preprocessMessages(messages, false, true);

    const controller = new AbortController();
    currentGeneration = controller;

    const stream = await deepinfraclient.chat.completions.create({
        model: document.getElementById("model").value,
        messages: messages,
        stream: true,
        temperature: settings.temperature !== undefined ? settings.temperature : 0.7,
        max_tokens: settings.max_tokens || 26000,
        top_p: settings.top_p !== undefined ? settings.top_p : 1,
        frequency_penalty: settings.frequency_penalty || 0,
        presence_penalty: settings.presence_penalty || 0
    });

    for await (const chunk of stream) {
        if (generationStopped) {
            console.log("G4F generation stopped");
            break;
        }

        const content = chunk.choices?.[0]?.delta?.content;
        if (content) {
            handleEmit(content);
            console.log("G4F Sent chunk | Delta data: " + content);
        }
    }

    onFinish("");
}

// Hyper generation
export async function streamingGeneratingHyper(messages, hyperInstance, settings = {}) {
    if (generationStopped) return;

    if (!hyperInstance) {
        handleEmit("\n\n[Error: Hyper engine not initialized. Please select Hyper (Auto) engine first.]");
        onFinish("");
        return;
    }

    messages = preprocessMessages(messages, false, true);

    const controller = new AbortController();
    currentGeneration = controller;

    try {
        const availableModels = hyperInstance.getAvailableModels();
        const selectedModel = availableModels.length > 0 ? availableModels[0] : hyperInstance.current_best_model;

        if (selectedModel) {
            handleEmit(`[Using model: ${selectedModel}]\n\n`);
            console.log(`Hyper using model: ${selectedModel}`);
        } else {
            handleEmit("[Warning: No model selected, attempting generation...]\n\n");
        }

        let isFirstChunk = true;

        await hyperInstance.generateResponse(messages, true, (chunk) => {
            if (generationStopped) {
                console.log("Hyper generation stopped");
                return;
            }

            if (chunk) {
                if (isFirstChunk) {
                    const actualModel = hyperInstance.current_best_model;
                    console.log(`Hyper successfully using model: ${actualModel}`);
                    isFirstChunk = false;
                }

                handleEmit(chunk);
                console.log("Hyper Sent chunk | Delta data: " + chunk);
            }
        });

        onFinish("");
    } catch (error) {
        console.error("Hyper streaming error:", error);
        console.error("Current Hyper model selection:", hyperInstance.current_best_model);
        console.error("Hyper model statuses:", hyperInstance.status_models);
        handleEmit("\n\n[Error: Failed to generate response with Hyper engine]");
        onFinish("");
    }
}

// Pollinations generation
export async function streamingGeneratingPollinations(messages, settings = {}) {
    if (generationStopped) return;

    messages = preprocessMessages(messages, true);
    const endpoint = "https://text.pollinations.ai/openai";

    const controller = new AbortController();
    currentGeneration = controller;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messages: messages,
            model: document.getElementById("model").value,
            max_tokens: settings.max_tokens || 26000,
            temperature: settings.temperature !== undefined ? settings.temperature : 0.7,
            top_p: settings.top_p !== undefined ? settings.top_p : 1,
            frequency_penalty: settings.frequency_penalty || 0,
            presence_penalty: settings.presence_penalty || 0,
            stream: true
        }),
        signal: controller.signal
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        if (generationStopped) {
            reader.cancel();
            break;
        }

        const { done, value } = await reader.read();
        if (done) {
            onFinish("");
            break;
        }
        buffer += decoder.decode(value, { stream: true });

        const messages = buffer.split('\n\n');
        buffer = messages.pop() || '';

        if (buffer.length > 50000) {
            console.warn('Buffer too large, truncating');
            buffer = buffer.slice(-10000);
        }

        for (const message of messages) {
            if (generationStopped) break;

            const lines = message.split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') {
                        onFinish("");
                        return;
                    }

                    if (!data) continue;

                    try {
                        const parsed = JSON.parse(data);

                        if (!parsed || !parsed.choices || !Array.isArray(parsed.choices)) {
                            console.error('Invalid response structure:', data);
                            continue;
                        }

                        const content = parsed.choices[0]?.delta?.content;
                        if (content !== undefined && content !== null) {
                            handleEmit(content);
                            console.log("Pollinations Sent chunk | Delta data: " + content);
                        }
                    } catch (e) {
                        console.error('Error parsing chunk:', e, 'Raw data:', data);

                        if (data.includes('"content":"')) {
                            try {
                                const match = data.match(/"content":"([^"]*)"?/);
                                if (match && match[1]) {
                                    console.info('Recovered partial content:', match[1]);
                                    handleEmit(match[1]);
                                }
                            } catch (recoveryError) {
                                console.error('Failed to recover content from malformed data');
                            }
                        }
                    }
                }
            }
        }
    }
}

// Custom engine generation
export async function streamingGeneratingCustomEngine(messages, customEngineConfig, settings = {}) {
    if (generationStopped) return;

    messages = preprocessMessages(messages);

    if (!customEngineConfig.endpoint) {
        console.error('Custom engine endpoint not configured');
        window.socket.emit('message', 'Error: Custom engine not configured. Please configure it first.');
        onFinish("");
        return;
    }

    const controller = new AbortController();
    currentGeneration = controller;

    try {
        let requestBody;
        let headers = {
            'Content-Type': 'application/json',
        };

        // Build request based on engine type
        if (customEngineConfig.type === 'openai') {
            requestBody = {
                model: customEngineConfig.model || document.getElementById("model").value,
                messages: messages,
                stream: true,
                max_tokens: settings.max_tokens || 26000,
                temperature: settings.temperature !== undefined ? settings.temperature : 0.7,
                top_p: settings.top_p !== undefined ? settings.top_p : 1,
                frequency_penalty: settings.frequency_penalty || 0,
                presence_penalty: settings.presence_penalty || 0
            };

            if (customEngineConfig.apiKey) {
                headers['Authorization'] = `Bearer ${customEngineConfig.apiKey}`;
            }

        } else if (customEngineConfig.type === 'gemini') {
            const geminiContents = [];
            let systemPrompt = '';

            for (const msg of messages) {
                if (msg.role === 'system') {
                    systemPrompt += msg.content + '\n';
                } else if (msg.role === 'user') {
                    const userContent = systemPrompt ? systemPrompt + msg.content : msg.content;
                    geminiContents.push({
                        role: 'user',
                        parts: [{ text: userContent }]
                    });
                    systemPrompt = '';
                } else if (msg.role === 'assistant') {
                    geminiContents.push({
                        role: 'model',
                        parts: [{ text: msg.content }]
                    });
                }
            }

            requestBody = {
                contents: geminiContents,
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_LOW_AND_ABOVE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_LOW_AND_ABOVE" }
                ],
                generationConfig: {
                    temperature: settings.temperature !== undefined ? settings.temperature : 0.7,
                    maxOutputTokens: settings.max_tokens || 26000,
                    topP: settings.top_p !== undefined ? settings.top_p : 1
                }
            };

            if (customEngineConfig.apiKey) {
                headers['x-goog-api-key'] = customEngineConfig.apiKey;
                delete headers['Authorization'];
            }

        } else if (customEngineConfig.type === 'nvidia') {
            requestBody = {
                model: customEngineConfig.model || document.getElementById("model").value,
                messages: messages,
                stream: true,
                max_tokens: settings.max_tokens || 2048,
                temperature: settings.temperature !== undefined ? settings.temperature : 0.7,
                top_p: settings.top_p !== undefined ? settings.top_p : 1,
                frequency_penalty: settings.frequency_penalty || 0.0,
                presence_penalty: settings.presence_penalty || 0.0
            };

            if (customEngineConfig.apiKey) {
                headers['Authorization'] = `Bearer ${customEngineConfig.apiKey}`;
            }

            if (customEngineConfig.nvidiaOrgId) {
                headers['NVCF-ORG-ID'] = customEngineConfig.nvidiaOrgId;
            }

            headers['Accept'] = 'application/json';

        } else {
            requestBody = {
                model: customEngineConfig.model || document.getElementById("model").value,
                messages: messages,
                stream: true
            };

            if (customEngineConfig.apiKey) {
                headers['Authorization'] = `Bearer ${customEngineConfig.apiKey}`;
            }
        }

        console.log('Custom engine request:', customEngineConfig.endpoint, requestBody);

        const response = await fetch(customEngineConfig.endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            if (generationStopped) {
                reader.cancel();
                break;
            }

            const { done, value } = await reader.read();
            if (done) {
                onFinish("");
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (generationStopped) break;

                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') {
                        onFinish("");
                        return;
                    }

                    if (!data) continue;

                    try {
                        const parsed = JSON.parse(data);
                        let content = null;

                        if (customEngineConfig.type === 'gemini') {
                            content = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                        } else {
                            content = parsed.choices?.[0]?.delta?.content;
                        }

                        if (content !== undefined && content !== null) {
                            handleEmit(content);
                            console.log("Custom Engine Sent chunk | Delta data: " + content);
                        }
                    } catch (e) {
                        console.error('Error parsing custom engine chunk:', e, 'Raw data:', data);
                    }
                }
            }
        }

    } catch (error) {
        console.error('Custom engine error:', error);
        window.socket.emit('message', `Error with custom engine: ${error.message}`);
        onFinish("");
    }
}
