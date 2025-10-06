console.log("---------------")
console.log("Hyper | Ver 0.0")
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
      "gemini",
      "deepseek-reasoning",
      "deepseek",
      "qwen3-coder:480b",
      "deepseek-v3.1:671b",
      "moonshotai/kimi-k2-instruct",
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
      "qwen3-coder:480b": "ollama",
      "deepseek-v3.1:671b": "ollama",
    };

    this.endpoints = {
      "pollig4f": "https://g4f.dev/api/pollinations.ai",
      "groq": "https://g4f.dev/api/groq",
      "ollama": "https://g4f.dev/api/ollama"
    };
  }

  async autoCheck() {
    for (let model of this.models) {
      let model_engine = this.conversion[model];
      let endpoint = this.endpoints[model_engine] + "/chat/completions";

      try {
        let response = await fetch(endpoint, {
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
        });

        let data = await response.json();

        if (response.ok && data.choices && data.choices[0].message.content.includes("test")) {
          this.status[model_engine] = [1, Date.now()];
          this.status_models[model] = [1, Date.now()];
        } else {
          this.status[model_engine] = [-1, Date.now()];
          this.status_models[model] = [-1, Date.now()];
        }
      } catch (e) {
        console.log(`Error handling model: ${model} - ${e}`);
        this.status[model_engine] = [-1, Date.now()];
        this.status_models[model] = [-1, Date.now()];
      }
    }

    for (let model of this.models) {
      if (this.status_models[model][0] === 1) {
        this.current_best_model = model;
        break;
      }
    }
  }

  async generateResponse(messages, streaming = true, callback = null) {
    // check statuses
    if (!this.current_best_model) {
      throw new Error("No available model found. Run autoCheck first.");
    }

    let model = this.current_best_model;
    let model_engine = this.conversion[model];
    let endpoint = this.endpoints[model_engine] + "/chat/completions";

    if (streaming === false) {
      try {
        let response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            "messages": messages,
            "model": model
          })
        });

        let data = await response.json();
        if (response.ok && data.choices) {
          return data.choices[0].message.content;
        } else {
          throw new Error("Invalid response");
        }
      } catch (e) {
        console.error(`Error generating response: ${e}`);
        throw e;
      }
    } else {
      try {
        let response = await fetch(endpoint, {
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
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let lines = buffer.split('\n');
          buffer = lines.pop(); // Keep incomplete line
          for (let line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6).trim();
              if (dataStr === '[DONE]') continue;
              try {
                const json = JSON.parse(dataStr);
                if (json.choices && json.choices[0].delta && json.choices[0].delta.content) {
                  let content = json.choices[0].delta.content;
                  if (callback) {
                    callback(content);
                  } else {
                    console.log(content);
                  }
                }
              } catch (parseError) {
                console.error(`Error parsing stream data: ${parseError}`);
              }
            }
          }
        }
      } catch (e) {
        console.error(`Error in streaming response: ${e}`);
        throw e;  
      }
    }
  }
} 