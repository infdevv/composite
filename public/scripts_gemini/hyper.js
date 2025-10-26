console.log("---------------")
console.log("Hyper | Ver 0.1")
console.log("For: Composite &")
console.log("KiwiAI (and other Labo projects)")
console.log("---------------")

class Hyper {
  constructor(apis) {
    this.total_apis = ["pollig4f", "groq", "ollama"];

    // If 0, its unchecked, if -1, its unresponding, if 1, its up
    this.status = {
      "pollig4f": [0, Date.now()],
      "groq": [0, Date.now()],
      "ollama": [0, Date.now()],
    };

    this.status_models = {};
    this.models = [
      "qwen3-coder:480b",
      "deepseek-v3.1:671b",
      "moonshotai/kimi-k2-instruct",
      "gemini",
      "deepseek-reasoning",
      "deepseek",
      "mistral"
    ];

    // Initialize status for all models
    for (let model of this.models) {
      this.status_models[model] = [0, Date.now()];
    }

    this.current_best_model = "";

    this.conversion = {
      "gemini": "pollig4f",
      "deepseek": "pollig4f",
      "deepseek-reasoning": "pollig4f",
      "mistral": "pollig4f",
      "moonshotai/kimi-k2-instruct": "groq",
      "grok-4-fast-non-reasoning": "grok",
      "qwen3-coder:480b": "ollama",
      "deepseek-v3.1:671b": "ollama",
    };

    this.endpoints = {
      "pollig4f": "https://g4f.dev/api/pollinations.ai",
      "groq": "https://g4f.dev/api/groq",
      "grok": "https://g4f.dev/api/grok",
      "ollama": "https://g4f.dev/api/ollama"
    };

    // Configuration for stability
    this.config = {
      timeout: 30000, // 30 seconds
      maxRetries: 3,
      retryDelay: 1000, // 1 second base delay
      checkDelay: 1000 // delay between checks
    };
  }

  // Helper method: fetch with timeout
  async fetchWithTimeout(url, options = {}, timeout = this.config.timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  // Helper method: retry with exponential backoff
  async retryWithBackoff(fn, maxRetries = this.config.maxRetries, baseDelay = this.config.retryDelay) {
    let lastError;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (i < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, i);
          console.log(`Retry ${i + 1}/${maxRetries} after ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  async autoCheck() {
    console.log("Starting autoCheck for all models...");

    for (let i = 0; i < this.models.length; i++) {
      let model = this.models[i];
      let model_engine = this.conversion[model];

      // Validate model configuration
      if (!model_engine) {
        console.error(`Model "${model}" not found in conversion map`);
        this.status_models[model] = [-1, Date.now()];
        continue;
      }

      if (!this.endpoints[model_engine]) {
        console.error(`Endpoint for engine "${model_engine}" not found`);
        this.status_models[model] = [-1, Date.now()];
        continue;
      }

      let endpoint = this.endpoints[model_engine] + "/chat/completions";

      try {
        // Use retry logic for health checks
        const checkModel = async () => {
          let response = await this.fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              "messages": [
                {"role": "user", "content": "Respond with the word test, nothing else."}
              ],
              "model": model
            })
          }, 10000); // 10 second timeout for health checks

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          let data = await response.json();

          // Validate response structure
          if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
            throw new Error("Invalid response structure: missing choices array");
          }

          if (!data.choices[0].message || !data.choices[0].message.content) {
            throw new Error("Invalid response structure: missing message content");
          }

          if (data.choices[0].message.content.toLowerCase().includes("test")) {
            return true;
          } else {
            throw new Error("Model response validation failed");
          }
        };

        await this.retryWithBackoff(checkModel, 2, 500); // Only 2 retries for checks

        this.status[model_engine] = [1, Date.now()];
        this.status_models[model] = [1, Date.now()];
        console.log(`✓ Model "${model}" is available`);

      } catch (e) {
        console.error(`✗ Model "${model}" failed: ${e.message}`);
        this.status[model_engine] = [-1, Date.now()];
        this.status_models[model] = [-1, Date.now()];
      }

      // Add delay between requests to avoid rate limiting
      if (i < this.models.length - 1) {
        await new Promise(resolve => setTimeout(resolve, this.config.checkDelay));
      }
    }

    // Find best available model
    for (let model of this.models) {
      if (this.status_models[model][0] === 1) {
        this.current_best_model = model;
        console.log(`Best available model: ${model}`);
        break;
      }
    }

    if (!this.current_best_model) {
      console.warn("WARNING: No models are currently available!");
    }
  }

  // Helper method: get available models sorted by priority
  getAvailableModels() {
    return this.models.filter(model => this.status_models[model] && this.status_models[model][0] === 1);
  }

  async generateResponse(messages, streaming = true, callback = null) {
    // Validate messages
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw new Error("Invalid messages parameter: must be a non-empty array");
    }

    // Get all available models
    const availableModels = this.getAvailableModels();

    if (availableModels.length === 0) {
      throw new Error("No available models found. Run autoCheck first or all models are down.");
    }

    // Try each available model with fallback
    let lastError = null;

    for (const model of availableModels) {
      try {
        console.log(`Attempting to generate response with model: ${model}`);

        const model_engine = this.conversion[model];
        if (!model_engine || !this.endpoints[model_engine]) {
          console.error(`Invalid configuration for model: ${model}`);
          continue;
        }

        const endpoint = this.endpoints[model_engine] + "/chat/completions";

        if (streaming === false) {
          return await this._generateNonStreamingResponse(endpoint, messages, model);
        } else {
          return await this._generateStreamingResponse(endpoint, messages, model, callback);
        }

      } catch (e) {
        lastError = e;
        console.error(`Model ${model} failed: ${e.message}. Trying next available model...`);
        // Mark this model as failing
        this.status_models[model] = [-1, Date.now()];

        // Update current_best_model to next available
        const remaining = this.getAvailableModels();
        if (remaining.length > 0) {
          this.current_best_model = remaining[0];
        } else {
          this.current_best_model = "";
        }
      }
    }

    throw new Error(`All available models failed. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  async _generateNonStreamingResponse(endpoint, messages, model) {
    const makeRequest = async () => {
      let response = await this.fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          "messages": messages,
          "model": model
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      let data = await response.json();

      // Validate response structure
      if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
        throw new Error("Invalid response structure: missing choices array");
      }

      if (!data.choices[0].message || typeof data.choices[0].message.content !== 'string') {
        throw new Error("Invalid response structure: missing or invalid message content");
      }

      return data.choices[0].message.content;
    };

    return await this.retryWithBackoff(makeRequest);
  }

  async _generateStreamingResponse(endpoint, messages, model, callback) {
    const makeRequest = async () => {
      let response = await this.fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          "messages": messages,
          "model": model,
          "stream": true
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("Response body is null");
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      let hasReceivedContent = false;

      try {
        while (true) {
          const { value, done } = await reader.read();

          if (done) {
            if (!hasReceivedContent) {
              throw new Error("Stream ended without receiving any content");
            }
            break;
          }

          buffer += value;
          let lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line

          for (let line of lines) {
            line = line.trim();
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6).trim();
              if (dataStr === '[DONE]') continue;

              try {
                const json = JSON.parse(dataStr);
                if (json.choices && json.choices[0]?.delta?.content) {
                  let content = json.choices[0].delta.content;
                  hasReceivedContent = true;
                  if (callback) {
                    callback(content);
                  } else {
                    console.log(content);
                  }
                }
              } catch (parseError) {
                console.error(`Error parsing stream data: ${parseError.message}`);
                // Continue processing other lines
              }
            }
          }
        }
      } finally {
        // Always release the reader
        reader.releaseLock();
      }
    };

    // Streaming responses don't retry - they either work or fail
    return await makeRequest();
  }
} 