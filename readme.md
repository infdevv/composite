# Composite V5

Composite is a proxy that allows for users to utilize their own browser as a proxy, while utilizing compsite as a middle man to get chunks to any requestor as long as its using the available API-key.

## Features:

- Deepinfra Support
Allows for users to pick from any model in the [DeepInfra](https://deepinfra.com) libary to use.

- Gemini support:
Explicit Gemini support allows for users to use [Google's Gemini](https://gemini.google.com) **without experiencing 429 errors without it being Google's fault.**

- Advanced Routers:
Users can select how they want requests routed to models based on either personal taste or what a router deems to be the best fit for the situation. On-top of this, routers can control model temperature, system prompt and other such factors that influence response.

- Built-in Prompts:
Users can use a variety of prompts, from the built in prompt selector, featuring external prompts and some Composite Exclusive™.

- Smart fallbacks:
Due to the unreliability of the system due to the general facts of how it works, Composite comes with multiple fallback layers to keep responses stable.

- No server pressure:
Composite's LLM generation mechanisms operate fully in client side, with server only being needed for endpoint functionality and websockets, meaning it can be run on a literal patato.

> Made with lettuce, 2025
