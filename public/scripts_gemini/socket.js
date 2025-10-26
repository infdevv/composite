// Socket.IO connection management
import {
    streamingGenerating,
    streamingGeneratingPollinations,
    streamingGeneratingYuzu,
    streamingGeneratingYuzuG4F,
    streamingGeneratingYuzuAuto,
    streamingGeneratingHyper,
    streamingGeneratingCustomEngine,
    streamingGeneratingGemini,
    stopGeneration,
    generationStopped
} from './generation.js';

// Removed reconnection variables
let lastHeartbeatTime = Date.now();
let connectionHealthStatus = 'connecting';

// Connection status indicator
export function updateConnectionStatus(connected) {
    connectionHealthStatus = connected ? 'connected' : 'disconnected';
    let statusIndicator = document.getElementById('connection-status');
    if (!statusIndicator) {
        statusIndicator = document.createElement('div');
        statusIndicator.id = 'connection-status';
        statusIndicator.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
            z-index: 10000;
            transition: all 0.3s ease;
        `;
        document.body.appendChild(statusIndicator);
    }

    if (connected) {
        lastHeartbeatTime = Date.now();
        statusIndicator.textContent = '● Connected';
        statusIndicator.style.backgroundColor = '#4CAF50';
        statusIndicator.style.color = 'white';
        setTimeout(() => {
            statusIndicator.style.opacity = '0';
        }, 2000);
    } else {
        statusIndicator.textContent = '● Disconnected';
        statusIndicator.style.backgroundColor = '#f44336';
        statusIndicator.style.color = 'white';
        statusIndicator.style.opacity = '1';
    }
}



// Initialize socket connection
export function initializeSocket() {
    // Don't create a new socket if one exists and is connecting/connected
    if (window.socket) {
        if (window.socket.connected) {
            console.log('Socket already connected, skipping initialization');
            return;
        }
        if (window.socket.io && window.socket.io.engine && window.socket.io.engine.readyState !== 'closed') {
            console.log('Socket exists and is connecting, skipping initialization');
            return;
        }
        // Clean up old listeners before creating new socket
        try {
            window.socket.removeAllListeners();
            if (window.socket.connected) {
                window.socket.disconnect();
            }
        } catch (error) {
            console.warn('Error cleaning up old socket:', error);
        }
    }

    if (typeof io !== 'undefined') {
        const userKey = document.getElementById("key").innerHTML;
        if (!userKey || userKey === '[Loading...]') {
            console.warn('User key not loaded yet, deferring socket initialization');
            setTimeout(initializeSocket, 1000);
            return;
        }

        try {
            window.socket = io('/socket', {
                query: {
                    key: userKey
                },
                transports: ['websocket', 'polling'],
                upgrade: true,
                rememberUpgrade: true,
                reconnection: false, // Disable automatic reconnection
                timeout: 20000, // Connection timeout
                forceNew: true, // Always create a new connection
                autoConnect: true
            });
        } catch (error) {
            console.error('Failed to create socket connection:', error);
            setTimeout(initializeSocket, 5000); // Retry after 5 seconds
            return;
        }

        window.socket.on('connect', () => {
            console.log('Socket connected successfully');
            lastHeartbeatTime = Date.now();
            updateConnectionStatus(true);
        });

        window.socket.on('disconnect', (reason) => {
            console.log('Socket disconnected:', reason);
            connectionHealthStatus = 'disconnected';
            updateConnectionStatus(false);
        });

        window.socket.on('connect_error', (error) => {
            console.error('Socket connection error:', error.message);
            connectionHealthStatus = 'error';
            updateConnectionStatus(false);
        });




        // Send periodic heartbeat to server for connection monitoring
        setInterval(() => {
            if (window.socket && window.socket.connected) {
                window.socket.emit('heartbeat');
                lastHeartbeatTime = Date.now(); // Update last heartbeat time
            }
        }, 30000); // Send heartbeat every 30 seconds

        window.socket.on('start_generate', async (data) => {
            console.log('Received start_generate signal from server');
            const { messages, settings } = data;
            let parsedMessages = JSON.parse(messages);

            // Log received settings
            console.log('Generation settings:', settings);


            if (document.getElementById("donate").checked) {
                try {
                    fetch('/donate', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ messages: parsedMessages })
                    });
                } catch (e) {
                    // Silent fail
                }
            }

            let type = document.getElementById("engine").value?.trim();
            console.log('=== ENGINE ROUTING DEBUG ===');
            console.log('Selected engine type:', type);
            console.log('Engine type (typeof):', typeof type);
            console.log('Engine type length:', type?.length);
            console.log('Equals "Google Gemini"?', type === "Google Gemini");
            console.log('Custom engine config:', window.customEngineConfig);
            console.log('=========================');

            if (type === "WebLLM (Local AI)") {
                console.log('Starting WebLLM generation');
                streamingGenerating(parsedMessages, window.webllmEngine, settings);
            } else if (type === "Pollinations (Cloud AI)") {
                console.log('Starting Pollinations generation');
                streamingGeneratingPollinations(parsedMessages, settings);
            } else if (type === "Yuzu (Cloud AI)") {
                console.log('Starting Yuzu generation');
                streamingGeneratingYuzu(parsedMessages, settings);
            } else if (type === "Yuzu (G4F)") {
                console.log('Starting Yuzu (G4F) generation');
                streamingGeneratingYuzuG4F(parsedMessages, settings);
            } else if (type === "Yuzu (AUTO)") {
                console.log('Starting Yuzu AUTO generation');
                streamingGeneratingYuzuAuto(parsedMessages, settings);
            } else if (type === "Hyper (Auto)") {
                console.log('Starting Hyper generation');
                streamingGeneratingHyper(parsedMessages, window.hyperInstance, settings);
            } else if (type === "Custom Engine") {
                console.log('=== CUSTOM ENGINE DEBUG ===');
                console.log('window.customEngineConfig:', window.customEngineConfig);
                console.log('localStorage customEngineConfig:', localStorage.getItem('customEngineConfig'));
                console.log('Endpoint:', window.customEngineConfig.endpoint);
                console.log('Model:', window.customEngineConfig.model);
                console.log('Type:', window.customEngineConfig.type);
                console.log('Has API Key:', !!window.customEngineConfig.apiKey);
                console.log('=========================');
                streamingGeneratingCustomEngine(parsedMessages, window.customEngineConfig, settings);
            } else if (type === "Google Gemini") {
                console.log('Starting Google Gemini generation');
                streamingGeneratingGemini(parsedMessages, settings);
            } else {
                console.error('Unknown engine type:', type);
                try {
                    window.socket.emit('message', `Error: Unknown engine type: ${type}`);
                    window.socket.emit('done');
                } catch (error) {
                    console.error('Failed to emit error to server:', error);
                }
            }
        });

        window.socket.on('stop_generation', () => {
            console.log('Received stop generation signal from server');
            setTimeout(() => {
                if (generationStopped) return;
                console.log('Confirming generation stop after delay');
                stopGeneration();
            }, 1000);
        });
    } else {
        console.error('Socket.IO not loaded');
    }
}

// WebSocket connection control functions
export function manualConnect() {
    const statusDiv = document.getElementById('connection-status-debug');
    statusDiv.innerHTML = '<span style="color: #ffd43b;">Attempting to connect...</span>';

    try {
        initializeSocket();
        setTimeout(() => {
            if (window.socket && window.socket.connected) {
                statusDiv.innerHTML = '<span style="color: #74db7a;">✓ Successfully connected to backend</span>\n';
                statusDiv.innerHTML += `Socket ID: ${window.socket.id}\n`;
                statusDiv.innerHTML += `Transport: ${window.socket.io.engine.transport.name}\n`;
                statusDiv.innerHTML += `Key: ${document.getElementById('key').innerHTML}`;
            } else {
                statusDiv.innerHTML = '<span style="color: #ff6b6b;">✗ Connection failed or still connecting...</span>\n';
                statusDiv.innerHTML += 'Check console for details';
            }
        }, 1000);
    } catch (error) {
        statusDiv.innerHTML = `<span style="color: #ff6b6b;">✗ Error: ${error.message}</span>`;
    }
}

export function manualDisconnect() {
    const statusDiv = document.getElementById('connection-status-debug');

    if (!window.socket) {
        statusDiv.innerHTML = '<span style="color: #ffa500;">⚠ No socket instance exists</span>';
        return;
    }

    try {
        connectionHealthStatus = 'disconnected';
        window.socket.disconnect();
        statusDiv.innerHTML = '<span style="color: #ffa500;">✓ Disconnected from backend</span>\n';
        statusDiv.innerHTML += 'Socket has been manually disconnected\n';
        statusDiv.innerHTML += 'Use "Connect" button to reconnect';
    } catch (error) {
        statusDiv.innerHTML = `<span style="color: #ff6b6b;">✗ Error: ${error.message}</span>`;
    }
}

export function checkConnectionStatus() {
    const statusDiv = document.getElementById('connection-status-debug');

    if (!window.socket) {
        statusDiv.innerHTML = '<span style="color: #ff6b6b;">✗ Socket not initialized</span>\n';
        statusDiv.innerHTML += 'Click "Connect" to establish connection';
        return;
    }

    const connected = window.socket.connected;
    const timestamp = new Date().toLocaleTimeString();
    const timeSinceHeartbeat = Date.now() - lastHeartbeatTime;

    if (connected) {
        statusDiv.innerHTML = `<span style="color: #74db7a;">✓ CONNECTED</span>\n`;
        statusDiv.innerHTML += `─────────────────────────\n`;
        statusDiv.innerHTML += `Socket ID: ${window.socket.id || 'N/A'}\n`;
        statusDiv.innerHTML += `Transport: ${window.socket.io.engine?.transport?.name || 'N/A'}\n`;
        statusDiv.innerHTML += `User Key: ${document.getElementById('key').innerHTML}\n`;
        statusDiv.innerHTML += `Health Status: ${connectionHealthStatus}\n`;
        statusDiv.innerHTML += `Last Heartbeat: ${Math.round(timeSinceHeartbeat / 1000)}s ago\n`;
        statusDiv.innerHTML += `Checked at: ${timestamp}`;
    } else {
        statusDiv.innerHTML = `<span style="color: #ff6b6b;">✗ DISCONNECTED</span>\n`;
        statusDiv.innerHTML += `─────────────────────────\n`;
        statusDiv.innerHTML += `Socket exists: Yes\n`;
        statusDiv.innerHTML += `Connection: Inactive\n`;
        statusDiv.innerHTML += `Health Status: ${connectionHealthStatus}\n`;
        statusDiv.innerHTML += `Last Heartbeat: ${Math.round(timeSinceHeartbeat / 1000)}s ago\n`;
        statusDiv.innerHTML += `Checked at: ${timestamp}\n\n`;
        statusDiv.innerHTML += `<span style="color: #ffa500;">Use "Connect" to reconnect manually</span>`;
    }
}

// Backend connection test function
export async function sendTestMessage() {
    const testMessage = document.getElementById('test-message').value.trim();
    const responseDiv = document.getElementById('test-response');
    const statusSpan = document.getElementById('test-status');

    if (!testMessage) {
        responseDiv.textContent = 'Error: Please enter a test message';
        responseDiv.style.color = '#ff6b6b';
        return;
    }

    const userKey = document.getElementById('key').innerHTML;
    if (!userKey || userKey === '[Loading...]') {
        responseDiv.textContent = 'Error: User key not loaded yet';
        responseDiv.style.color = '#ff6b6b';
        return;
    }

    statusSpan.textContent = 'Sending request...';
    statusSpan.style.color = '#ffd43b';
    responseDiv.textContent = 'Waiting for response...\n';
    responseDiv.style.color = '#fff';

    try {
        // Allow requesting a non-stream response by checking a checkbox `non-stream-response`
        const wantsNonStream = document.getElementById('non-stream-response') ? document.getElementById('non-stream-response').checked : false;

        const response = await fetch('/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userKey}`
            },
            body: JSON.stringify({
                stream: wantsNonStream ? false : undefined,
                non_stream: wantsNonStream ? true : undefined,
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: testMessage }
                ]
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        statusSpan.textContent = 'Receiving...';
        statusSpan.style.color = '#74db7a';

        // Handle either streaming SSE-like responses or a single non-stream JSON response
        const contentType = response.headers.get('content-type') || '';
        let fullResponse = '';

        if (wantsNonStream || contentType.includes('application/json')) {
            // Non-stream aggregated JSON response
            try {
                const json = await response.json();
                const content = json?.choices?.[0]?.message?.content || json?.choices?.[0]?.delta?.content || '';
                fullResponse = content || JSON.stringify(json);
                responseDiv.textContent = fullResponse;
                responseDiv.scrollTop = responseDiv.scrollHeight;
                statusSpan.textContent = 'Complete';
                statusSpan.style.color = '#51cf66';
            } catch (e) {
                console.error('Error parsing non-stream JSON response:', e);
                responseDiv.textContent = 'Error parsing JSON response';
                statusSpan.textContent = 'Error';
                statusSpan.style.color = '#ff6b6b';
            }
        } else {
            // Streaming path (SSE chunks)
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            responseDiv.textContent = '';

            let connectionTimeout = setTimeout(() => {
                if (!reader.closed) {
                    console.warn('Connection timeout during streaming test');
                    statusSpan.textContent = 'Timeout';
                    statusSpan.style.color = '#ffa500';
                    reader.cancel();
                }
            }, 30000); // 30 second timeout
        
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
        
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
        
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        if (data === '[DONE]') {
                            clearTimeout(connectionTimeout);
                            statusSpan.textContent = 'Complete';
                            statusSpan.style.color = '#51cf66';
                            break;
                        }
        
                        if (!data) continue;
        
                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.delta?.content;
                            if (content !== undefined && content !== null) {
                                fullResponse += content;
                                responseDiv.textContent = fullResponse;
                                responseDiv.scrollTop = responseDiv.scrollHeight;
                                // Reset timeout on successful data
                                clearTimeout(connectionTimeout);
                                connectionTimeout = setTimeout(() => {
                                    if (!reader.closed) {
                                        console.warn('Connection timeout during streaming test');
                                        statusSpan.textContent = 'Timeout';
                                        statusSpan.style.color = '#ffa500';
                                        reader.cancel();
                                    }
                                }, 30000);
                            }
                        } catch (e) {
                            console.error('Error parsing test response:', e);
                        }
                    }
                }
            }
        
            clearTimeout(connectionTimeout);
        }

        if (!fullResponse) {
            responseDiv.textContent = 'No response received from backend';
            responseDiv.style.color = '#ffa500';
            statusSpan.textContent = 'No response';
            statusSpan.style.color = '#ffa500';
        }

    } catch (error) {
        console.error('Test message error:', error);
        responseDiv.textContent = `Error: ${error.message}\n\nMake sure:\n1. You clicked "Start" to load the model\n2. The socket connection is active\n3. The backend is running`;
        responseDiv.style.color = '#ff6b6b';
        statusSpan.textContent = 'Error';
        statusSpan.style.color = '#ff6b6b';
    }
}