// Generation-related functions for all engines
import { prompts } from "./constants.js";
import Yuzu from "../yuzu/client.js";

const yuzuClient = new Yuzu();

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


async function router(messages, yuzuapi) {
    // get last 5 messages only
    messages = messages.slice(-5);
    let prompt = `
You are a **model router** for a role‑play platform.
Your job is to examine the conversation history (messages) and the
information about each available model, then select the **single best
model** to generate the next assistant response.
Choose the model that gives the highest quality for the required
behaviour while also keeping latency low whenever possible.

### Routing Map
1. **Exceptional intelligence / heavy reasoning / high‑stakes scenes**  
   → *Reasoning models (high‑parameter, strong math‑/code‑/logic abilities)*  

2. **Erotic / adult role‑play scenes**  
   → *Erotic‑optimized models (trained on explicit data, good at tone &
   emotional nuance)*  

3. **Less‑complex or low‑stakes role‑play**  
   → *Lower‑parameter general‑purpose models (fast, low latency, enough
   coherence for simple dialogues)*  

4. **Quick‑paced back‑and‑forth conversation**  
   → *Fast, “chatty” models (good at turn‑taking, low cost)*  

When more than one rule applies, **prioritise the highest‑ranked rule**
(1 > 2 > 3 > 4).  If several models satisfy the same rule, pick the one
with the best overall quality/latency trade‑off for the current turn.

---

### Model Capability Table  

| Model ID (as in the list)                               | Params / Size* | Primary Strength / Typical Use | Routing Category | Notes |
|----------------------------------------------------------|----------------|--------------------------------|------------------|-------|
| **deepseek-ai/DeepSeek-V3.2-Exp**                        | ~635 B        | Long‑form storytelling, good narrative flow | 3 / 4 | |
| **deepseek-ai/DeepSeek-V3.1-Terminus**                   | ~635 B        | Strong narrative, decent reasoning | 3 / 4 | |
| **deepseek-ai/DeepSeek-V3.1**                            | ~635 B        | General purpose, fast | 3 / 4 | |
| **deepseek-ai/DeepSeek-R1-0528‑Turbo**                   | ~635 B           | High‑parameter reasoning, fast inference | **1** | |
| **deepseek-ai/DeepSeek-V3-0324**                          | ~635 B        | **Comedy & general‑RP** – excellent for light‑hearted, non‑specific scenes | 3 / 4 | *Great for humor, banter, and everyday role‑play* |
| **Qwen/Qwen3-235B-A22B-Instruct-2507**                    | 235 B          | Massive knowledge, heavy reasoning | **1** | |
| **Qwen/Qwen3-235B-A22B-Thinking-2507**                    | 235 B          | Chain‑of‑thought reasoning | **1** | |
| **Qwen/Qwen3-Next-80B-A3B-Instruct**                     | 80 B           | Strong reasoning, good coding | **1** | |
| **Qwen/Qwen3-Next-80B-A3B-Thinking**                     | 80 B           | Chain‑of‑thought reasoning | **1** | |
| **Qwen/QwQ-32B-Preview**                                 | 32 B           | Balanced reasoning / chat | **1** (if needed) | |
| **moonshotai/Kimi-K2-Instruct-0905**                     | 70‑405 B (K2)  | High‑quality chat, decent reasoning | 4 | |
| **zai-org/GLM-4.5**                                      | 4.5 B          | General chat, fast | 4 | |
| **zai-org/GLM-4.5‑Air**                                  | 4.5 B          | Light‑weight, cheap inference | 4 | |
| **Qwen/Qwen2.5-72B‑Instruct**                            | 72 B           | Strong reasoning, good coding | **1** | |
| **Qwen/Qwen2.5‑Coder‑32B‑Instruct**                      | 32 B           | Code‑focused reasoning | **1** | |
| **Qwen/Qwen2.5‑VL‑32B‑Instruct**                         | 32 B           | Multimodal (vision) + reasoning | **1** | |
| **Qwen/Qwen3‑VL‑30B‑A3B‑Instruct**                       | 30 B           | Vision + long context, moderate reasoning | **1** | |
| **Qwen/Qwen3‑VL‑30B‑A3B‑Thinking**                       | 30 B           | Same as above, tuned for chain‑of‑thought | **1** | |
| **Qwen/Qwen3‑14B**                                      | 14 B           | Mid‑size reasoning, decent speed | **1** | |
| **mistralai/Mixtral‑8x22B‑Instruct‑v0.1**                | 140 B (8×22 B) | Strong reasoning, diverse tasks | **1** | |
| **mistralai/Mistral‑Nemo‑Instruct‑2407**                | 12 B           | Fast, decent for simple RP | 3 / 4 | |
| **mistralai/Mistral‑Small‑3.2‑24B‑Instruct‑2506**       | 24 B           | Low‑latency, good for quick chat | 4 | |
| **mistralai/Mistral‑Small‑3.1‑24B‑Instruct‑2503**       | 24 B           | Same as above | 4 | |
| **google/gemma‑3‑27b‑it**                                | 27 B           | Strong reasoning for its size, good chat | 3 / 4 | |
| **google/gemma‑3‑12b‑it**                                | 12 B           | Fast, decent quality | 4 | |
| **google/gemma‑2‑27b‑it**                                | 27 B           | Balanced speed/quality | 3 / 4 | |
| **google/gemma‑2‑9b‑it**                                 | 9 B            | Very fast, low cost | 4 | |


Prompt List ( Pick one that you think suits the senario ):


None: No prompt modifications
infdevv: Smart roleplay
smolrp: Adaptive roleplay with authentic characters, 300-550+ words, cinematic composition. Focuses on genuine engagement over perfection.
slop: Adds common romance novel phrases like 'mind, body and soul' and 'ruin you for anyone else' excessively
unpositive: Removes positivity from roleplay, focuses on darker/grimmer tones
affection: Maximum affection mode - AI becomes extremely loving regardless of character personality
cheese: First-person POV, extremely explicit smut writing, detailed combat scenes, character development focus
pupi: 700-word max responses, third-person narrative, cinematic prose, slow-paced storytelling with psychological depth
teto: AI becomes obsessed with Kasane Teto regardless of your input. For memes only.
brbie: brbie ( General RP )
status: Shows the current status of the character



Only return the name of the model (e.g. **Qwen/Qwen2.5-72B-Instruct**, not "Qwen 72B") and the prompt

Eg: "google/gemma-2-9b-it,infdevv". 
ALWAYS USE THE FULL MODEL NAME. OTHERWISE YOU WILL CAUSE A ERROR, GOOFY.


    Messages:
    "${messages.join('\n### NEXT TURN:')}"
    `

    if (yuzuapi) {
        try {
            console.log("Router: Calling Yuzu API for model selection...");
            const response = await yuzuapi.generate([{ "role": "user", "content": prompt }]);
            console.log("Router response:", response);
            const content = response.choices?.[0]?.message?.content?.trim();
            console.log("Router raw content:", content);

            // Parse model and prompt from response
            // Expected format: "model-name prompt-name" (space-separated on single line)
            // Example: "google/gemma-2-9b-it,infdevv"
            const parts = content?.split(",") // Split by whitespace
            const model = parts?.[0]?.trim() || "google/gemma-2-9b-it";
            const promptName = parts?.[1]?.trim() || "none";


            console.log("Router extracted model:", model);
            console.log("Router extracted prompt:", promptName);

            return { model, prompt: promptName };
        } catch (error) {
            console.error("Router error:", error);
            return { model: "google/gemma-2-9b-it", prompt: "none" }; // fallback
        }
    } else {
        return { model: "google/gemma-2-9b-it", prompt: "none" }; // fallback
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

    if (yuzu) {
        messages[0]["content"] += "This roleplay is in English, ensure that your response is fully in english and coherent.";
    }

    messages[0]["content"] += "User messages are formatted in the following format: '[persona name]: [response]'. Do not treat persona name as a piece of input.";

    return messages;
}

export async function streamingGeneratingYuzuAuto(messages, settings = {}) {
    if (generationStopped) return;

    // hand messages over to router
    const routerResult = await router(messages, yuzuClient);

    console.log("Yuzu AUTO selected model:", routerResult.model);
    console.log("Yuzu AUTO selected prompt:", routerResult.prompt);

    // Pass both the model and prompt to streamingGeneratingYuzu
    try {
        await streamingGeneratingYuzu(messages, settings, routerResult.model, routerResult.prompt);
    }
    catch(error){
        console.error("Yuzu AUTO fallback due to error:", error);
        await streamingGeneratingYuzu(messages, settings, "google/gemma-2-9b-its", "none");
    }
}

export async function generateResponseYuzuAuto(messages, settings = {}) {
    // hand messages over to router
    const routerResult = await router(messages, yuzuClient);

    console.log("Yuzu AUTO (non-streaming) using model:", routerResult.model);
    console.log("Yuzu AUTO (non-streaming) using prompt:", routerResult.prompt);

    // Apply prompt preprocessing
    messages = preprocessMessages(messages, false, true, routerResult.prompt);

    let response;
    try {
        response = await yuzuClient.generate(messages, routerResult.model, settings);
    }
    catch(error){
        console.error("Yuzu AUTO (non-streaming) fallback due to error:", error);
        response = await yuzuClient.generate(messages, "zai-org/GLM-4.6", settings);
    }

    if (document.getElementById("show-router").checked) {
        // edit response message, oai style
        response.choices[0].message.content += "\n" + routerResult 
    }

    return response;
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

    let chunk_count = 0;
    let inReasoning = false;

    await yuzuClient.generateStreaming(messages, (chunk) => {
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
    const wantsNonStream = document.getElementById('non-stream-response') ? document.getElementById('non-stream-response').checked : false;

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
        const response = await fetch(endpoint, {
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
