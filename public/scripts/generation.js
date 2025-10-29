// Generation-related functions for all engines
import { prompts, routerPrompt } from "./constants.js";
import { proxyFetch } from "./utils.js";
import Yuzu from "../yuzu/client.js";

const yuzuClient = new Yuzu("https://gpt4free.pro/v1/chat/completions");
const yuzuClientG4F = new Yuzu("https://gpt4free.pro/v1/chat/completions");
const yuzuClientNormal = new Yuzu(); // Normal Yuzu without endpoint specification

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


async function router(messages) {
    // get last 5 messages only
    messages = messages.slice(-5);
    let prompt = `${routerPrompt}}
    Messages:
    "${messages.join('\n### NEXT TURN:')}"
    `

    try {
        console.log("Router: Calling Pollinations API for model selection...");

        // Use Pollinations API for routing
        const response = await proxyFetch("https://text.pollinations.ai/openai", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messages: [{ "role": "user", "content": prompt }],
                model: "openai",
                temperature: 0.7,
                max_tokens: 500
            })
        });

        const data = await response.json();
        console.log("Router response:", data);

        let content = data.choices?.[0]?.message?.content?.trim();
        console.log("Router raw content:", content);

        // extract JSON
        if (content.includes("```json")) {
            const startIndex = content.indexOf("```json") + "```json".length;
            const endIndex = content.lastIndexOf("```");
            content = content.substring(startIndex, endIndex);
        }

        // parse JSON
        content = JSON.parse(content);

        const model = content?.model || "google/gemma-2-9b-it";
        const promptName = content?.prompt || "none";
        const temperature = content?.temperature || 0.7;
        const top_p = content?.top_p || 1;
        const max_tokens = content?.max_tokens || 26000;

        console.log("Router extracted model:", model);
        console.log("Router extracted prompt:", promptName);
        console.log("Router extracted temperature:", temperature);
        console.log("Router extracted top_p:", top_p);
        console.log("Router extracted max_tokens:", max_tokens);

        return {
            model,
            prompt: promptName,
            temperature: temperature,
            top_p: top_p,
            max_tokens: max_tokens
        };
    } catch (error) {
        console.error("Router error:", error);
        return {
            model: "google/gemma-2-9b-it",
            prompt: "none",
            temperature: 0.7,
            top_p: 1,
            max_tokens: 26000
        }; // fallback
    }
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
export function preprocessMessages(messages, pollinations = false, yuzu = false, overridePrompt = null) {
    let imagemd = document.getElementById("enable-images-checkbox").checked;
    let prefix = overridePrompt || document.getElementById("prefix-prompt").value;
    let reasoning = document.getElementById("turn-on-reasoning").checked;

    let prefixContent = prompts[prefix] || "";

    if (imagemd) {
        prefixContent += prompts["image"] || "";
    }

    if (reasoning) {
        prefixContent += prompts["reasoning"] || "";
    }

    messages[0]["content"] = prefixContent + messages[0]["content"];

    if (pollinations) {
        messages[0]["content"] += Math.random() * 10000; // prevent pollinations from caching
    }

    if (yuzu) {
        messages[0]["content"] += "This roleplay is in English, ensure that your response is fully in english and coherent.";
    }

    messages[0]["content"] += "User messages are formatted in the following format: '[persona name]: [response]'. Do not treat persona name as a piece of input.";

    return messages;
}

export async function streamingGeneratingYuzuAuto(messages, settings = {}) {
    if (generationStopped) return;

    // hand messages over to router
    const routerResult = await router(messages);

    console.log("Yuzu AUTO selected model:", routerResult.model);
    console.log("Yuzu AUTO selected prompt:", routerResult.prompt);
    console.log("Yuzu AUTO selected temperature:", routerResult.temperature);
    console.log("Yuzu AUTO selected top_p:", routerResult.top_p);
    console.log("Yuzu AUTO selected max_tokens:", routerResult.max_tokens);

    // Merge router settings with provided settings
    const mergedSettings = {
        ...settings,
        temperature: routerResult.temperature,
        top_p: routerResult.top_p,
        max_tokens: routerResult.max_tokens
    };

    // Pass the model, prompt, and merged settings to streamingGeneratingYuzu
    try {
        await streamingGeneratingYuzu(messages, mergedSettings, routerResult.model, routerResult.prompt);
    }
    catch(error){
        console.error("Yuzu AUTO fallback due to error:", error);
        await streamingGeneratingYuzu(messages, settings, "google/gemma-2-9b-its", "none");
    }
}

export async function generateResponseYuzuAuto(messages, settings = {}) {
    // hand messages over to router
    const routerResult = await router(messages);

    console.log("Yuzu AUTO (non-streaming) using model:", routerResult.model);
    console.log("Yuzu AUTO (non-streaming) using prompt:", routerResult.prompt);
    console.log("Yuzu AUTO (non-streaming) using temperature:", routerResult.temperature);

    // Merge router settings with provided settings
    const mergedSettings = {
        ...settings,
        temperature: routerResult.temperature,
        top_p: routerResult.top_p,
        max_tokens: routerResult.max_tokens
    };

    // Apply prompt preprocessing
    messages = preprocessMessages(messages, false, true, routerResult.prompt);

    let response;
    try {
        response = await yuzuClient.generate(messages, routerResult.model, mergedSettings);
    }
    catch(error){
        console.error("Yuzu AUTO (non-streaming) fallback due to error:", error);
        response = await yuzuClient.generate(messages, "zai-org/GLM-4.6", settings);
    }

    if (document.getElementById("show-router").checked) {
        // edit response message, oai style
        response.choices[0].message.content += "\n" + JSON.stringify(routerResult, null, 2);
    }

    return response;
}

export async function streamingGeneratingGemini(messages, settings = {}) {
    if (generationStopped) return;

    messages = preprocessMessages(messages);

    const controller = new AbortController();
    currentGeneration = controller;

    const model = document.getElementById("model").value;

    let apiKey;
    if (window.getGeminiAPIKey) {
        apiKey = window.getGeminiAPIKey();
    } else {
        apiKey = document.getElementById("api-key-input")?.value;
    }

    if (!apiKey || apiKey === "[Loading...]" || apiKey === "[Not Set]") {
        handleEmit("Error: Google AI API key not set. Please enter your API key and click 'Save API Key'.");
        onFinish("");
        return;
    }

    try {
        const response = await proxyFetch("https://offshore.seabase.xyz/generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                stream: true,
                temperature: settings.temperature !== undefined ? settings.temperature : 0.7,
                max_tokens: 26000,
                top_p: settings.top_p !== undefined ? settings.top_p : 1
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Gemini API error:", response.status, errorText);
            handleEmit(`Error: Gemini API returned ${response.status}. ${errorText}`);
            onFinish("");
            return;
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
                        const content = parsed.choices?.[0]?.delta?.content;

                        if (content !== undefined && content !== null) {
                            handleEmit(content);
                            console.log("Gemini Sent chunk | Delta data: " + content);
                        }
                    } catch (e) {
                        console.error('Error parsing Gemini chunk:', e, 'Raw data:', data);
                    }
                }
            }
        }
    } catch (error) {
        console.error("Gemini streaming error:", error);
        handleEmit(`\n\nError: ${error.message}`);
        onFinish("");
    }
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

// Yuzu generation
export async function streamingGeneratingYuzu(messages, settings = {}, overrideModel = null, overridePrompt = null) {
    if (generationStopped) return;

    messages = preprocessMessages(messages, false, true, overridePrompt);

    const controller = new AbortController();
    currentGeneration = controller;

    const model = overrideModel || document.getElementById("model").value;

    console.log("Yuzu using model:", model);
    console.log("Yuzu using prompt:", overridePrompt || "default");
    console.log("Yuzu using settings:", settings);

    let chunk_count = 0;
    let inReasoning = false;

    await yuzuClientNormal.generateStreaming(messages, (chunk) => {
        if (generationStopped) {
            if (document.getElementById("show-router").checked) {

                // one last chunk for the road ahh
                handleEmit("\n\n" + routerResult["model"] + "\n" + routerResult["prompt"]);

            }
            console.log("Yuzu generation stopped");
            return;
        }

        if (chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) {
            const content = chunk.choices[0].delta.content;
            const reasoning_data = chunk.choices[0].reasoning_content;
            if (reasoning_data != null && content == null) {
                if (chunk_count == 0) {
                    handleEmit("<think>");
                    inReasoning = true;
                }
                chunk_count += 1;
                handleEmit(reasoning_data);
                console.log("Yuzu Sent reasoning chunk | Delta data: " + reasoning_data);
            }
            else {
                if (inReasoning) {
                    handleEmit("</think>");
                    inReasoning = false;
                }
                handleEmit(content);
                console.log("Yuzu Sent chunk | Delta data: " + content);
            }
        }
    }, model, settings);

    onFinish("");
}

// Yuzu (G4F) generation
export async function streamingGeneratingYuzuG4F(messages, settings = {}, overrideModel = null, overridePrompt = null) {
    if (generationStopped) return;

    messages = preprocessMessages(messages, false, true, overridePrompt);

    const controller = new AbortController();
    currentGeneration = controller;

    const model = overrideModel || document.getElementById("model").value;

    console.log("Yuzu (G4F) using model:", model);
    console.log("Yuzu (G4F) using prompt:", overridePrompt || "default");
    console.log("Yuzu (G4F) using settings:", settings);

    let chunk_count = 0;
    let inReasoning = false;

    await yuzuClientG4F.generateStreaming(messages, (chunk) => {
        if (generationStopped) {
            console.log("Yuzu (G4F) generation stopped");
            return;
        }

        if (chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) {
            const content = chunk.choices[0].delta.content;
            const reasoning_data = chunk.choices[0].reasoning_content;
            if (reasoning_data != null && content == null) {
                if (chunk_count == 0) {
                    handleEmit("<think>");
                    inReasoning = true;
                }
                chunk_count += 1;
                handleEmit(reasoning_data);
                console.log("Yuzu (G4F) Sent reasoning chunk | Delta data: " + reasoning_data);
            }
            else {
                if (inReasoning) {
                    handleEmit("</think>");
                    inReasoning = false;
                }
                handleEmit(content);
                console.log("Yuzu (G4F) Sent chunk | Delta data: " + content);
            }
        }
    }, model, settings);

    onFinish("");
}

// Pollinations generation
export async function streamingGeneratingPollinations(messages, settings = {}) {
    if (generationStopped) return;
    const wantsNonStream = document.getElementById('non-stream-response') ? document.getElementById('non-stream-response').checked : false;

    messages = preprocessMessages(messages, true);
    const endpoint = "https://text.pollinations.ai/openai";

    const controller = new AbortController();
    currentGeneration = controller;

    const response = await proxyFetch(endpoint, {
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
            stream: wantsNonStream ? false : true,
            non_stream: wantsNonStream ? true : undefined
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

    // Verify that Custom Engine is actually selected
    const selectedEngine = document.getElementById("engine")?.value;
    if (selectedEngine !== "Custom Engine") {
        console.error('Custom engine generation called but not selected');
        window.socket.emit('message', 'Error: Custom engine was triggered but is not selected. Please refresh the page.');
        onFinish("");
        return;
    }

    if (!customEngineConfig.endpoint) {
        console.error('Custom engine endpoint not configured');
        console.error('Current config:', customEngineConfig);
        window.socket.emit('message', 'Error: Custom engine endpoint not configured. Please enter your API endpoint URL in the Custom Engine Configuration section and click "Save Configuration".');
        onFinish("");
        return;
    }

    if (!customEngineConfig.model) {
        console.error('Custom engine model not configured');
        console.error('Current config:', customEngineConfig);
        window.socket.emit('message', 'Error: Custom engine model not configured. Please enter your model name in the Custom Engine Configuration section and click "Save Configuration".');
        onFinish("");
        return;
    }

    console.log('Custom engine config being used:', customEngineConfig);

    const controller = new AbortController();
    currentGeneration = controller;

    try {
        let requestBody;
        let headers = {
            'Content-Type': 'application/json',
        };
        let endpoint = customEngineConfig.endpoint; // Use local copy

        // Build request based on engine type
        const wantsNonStream = document.getElementById('non-stream-response') ? document.getElementById('non-stream-response').checked : false;

        if (customEngineConfig.type === 'openai') {
            requestBody = {
                model: customEngineConfig.model || document.getElementById("model").value,
                messages: messages,
                stream: wantsNonStream ? false : true,
                non_stream: wantsNonStream ? true : undefined,
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

            // For Gemini, the API key can be in header or query param
            // Standard Google AI Studio uses query parameter format
            if (customEngineConfig.apiKey) {
                if (!endpoint.includes('key=')) {
                    // Append API key as query parameter (standard Google AI Studio format)
                    const separator = endpoint.includes('?') ? '&' : '?';
                    endpoint = endpoint + separator + 'key=' + customEngineConfig.apiKey;
                }
                headers['x-goog-api-key'] = customEngineConfig.apiKey;
                delete headers['Authorization'];
            }

        } else {
            requestBody = {
                model: customEngineConfig.model || document.getElementById("model").value,
                messages: messages,
                stream: wantsNonStream ? false : true,
                non_stream: wantsNonStream ? true : undefined
            };

            if (customEngineConfig.apiKey) {
                headers['Authorization'] = `Bearer ${customEngineConfig.apiKey}`;
            }
        }

        console.log('Custom engine request: ' + endpoint);

        // Make direct request
        const response = await proxyFetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error('Custom engine API error:');
            console.error('  Status:', response.status);
            console.error('  Status Text:', response.statusText);
            console.error('  Endpoint:', endpoint);
            console.error('  Engine Type:', customEngineConfig.type);
            console.error('  Response body:', errorBody);

            let errorMessage = `Custom engine API error (${response.status}): ${response.statusText}`;
            if (errorBody) {
                try {
                    const errorJson = JSON.parse(errorBody);
                    errorMessage += `\n${JSON.stringify(errorJson, null, 2)}`;
                } catch {
                    errorMessage += `\n${errorBody.substring(0, 200)}`;
                }
            }

            window.socket.emit('message', errorMessage);
            onFinish("");
            return;
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
