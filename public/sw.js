// Service Worker for Fetch Debugging Middleware
const SW_VERSION = 'v1.0.1';
const CACHE_NAME = `fetch-debugger-${SW_VERSION}`;

// Configuration for debugging
const DEBUG_CONFIG = {
    enabled: true,
    logRequests: true,
    logResponses: true,
    logErrors: true,
    logTiming: true,
    maxLogEntries: 1000,
    // URLs to always intercept for debugging
    interceptPatterns: [
        '/v1/chat/completions',
        '/donate',
        '/health',
        'pollinations.ai',
        'deepinfra.com',
        'g4f.dev',
        'huggingface.co'
    ],
    // Headers to log (avoiding sensitive data)
    logHeaders: ['content-type', 'authorization', 'user-agent', 'accept'],
    // Response headers to log
    logResponseHeaders: ['content-type', 'content-length', 'cache-control']
};

// In-memory log storage per session
let logsBySession = new Map();

// Helper function to check if URL should be intercepted
function shouldIntercept(url) {
    if (!DEBUG_CONFIG.enabled) return false;

    return DEBUG_CONFIG.interceptPatterns.some(pattern =>
        url.includes(pattern)
    );
}

// Helper function to extract all headers
function extractAllHeaders(headers) {
    const extracted = {};
    if (!headers) return extracted;

    for (const [key, value] of headers.entries()) {
        extracted[key] = value;
    }

    return extracted;
}

// Helper function to add log entry
function addLogEntry(entry, sessionId) {
    if (!DEBUG_CONFIG.enabled) return;

    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        id: `${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
        ...entry
    };

    if (!logsBySession.has(sessionId)) {
        logsBySession.set(sessionId, []);
    }
    logsBySession.get(sessionId).unshift(logEntry);

    // Keep only the most recent entries per session
    const sessionLogs = logsBySession.get(sessionId);
    if (sessionLogs.length > DEBUG_CONFIG.maxLogEntries) {
        logsBySession.set(sessionId, sessionLogs.slice(0, DEBUG_CONFIG.maxLogEntries));
    }

    // Also log to console for immediate debugging
    const statusInfo = entry.response ?
        `[${entry.response.status} ${entry.response.statusText || ''}]` :
        (entry.error ? `[FETCH_ERROR: ${entry.error.message}]` : '[PENDING]');

    console.group(`🔍 Fetch Debug: ${entry.method} ${entry.url} ${statusInfo}`);
    console.log('Request:', entry.request);
    if (entry.response) {
        console.log('Response:', entry.response);
    }
    if (entry.error) {
        console.error('Error:', entry.error);
    }
    if (entry.timing) {
        console.log('Timing:', `${entry.timing.duration}ms`);
    }
    console.groupEnd();
}

// Helper function to clone request/response for logging
async function cloneForLogging(requestOrResponse, isRequest = true) {
    try {
        const cloned = requestOrResponse.clone();
        let body = null;

        // Try to read body content (if it exists and is readable)
        if (cloned.body && typeof cloned.text === 'function') {
            try {
                body = await cloned.text();
                // Log full body content without truncation
            } catch (e) {
                body = '[Could not read body]';
            }
        }

        return {
            url: isRequest ? cloned.url : undefined,
            method: isRequest ? cloned.method : undefined,
            headers: isRequest ? extractAllHeaders(cloned.headers) : extractAllHeaders(cloned.headers),
            status: !isRequest ? cloned.status : undefined,
            statusText: !isRequest ? cloned.statusText : undefined,
            body: body,
            type: cloned.type,
            ok: !isRequest ? cloned.ok : undefined
        };
    } catch (error) {
        return {
            error: 'Failed to clone for logging: ' + error.message
        };
    }
}

// Main fetch interceptor
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = request.url;

    // Only intercept requests we want to debug
    if (!shouldIntercept(url)) {
        return; // Let the request proceed normally
    }

    event.respondWith(
        (async () => {
            const startTime = performance.now();
            let requestData = null;
            let responseData = null;
            let errorData = null;

            // Get sessionId from request header
            const sessionId = request.headers.get('X-Session-ID') || 'default';

            try {
                // Log request details
                if (DEBUG_CONFIG.logRequests) {
                    requestData = await cloneForLogging(request, true);
                }

                // Perform the actual fetch
                const response = await fetch(request.clone());
                const endTime = performance.now();

                // Log response details
                if (DEBUG_CONFIG.logResponses) {
                    responseData = await cloneForLogging(response, false);
                }

                // Create debug log entry
                const logEntry = {
                    type: 'fetch',
                    method: request.method,
                    url: url,
                    request: requestData,
                    response: responseData,
                    timing: DEBUG_CONFIG.logTiming ? {
                        duration: Math.round(endTime - startTime),
                        start: startTime,
                        end: endTime
                    } : null
                };

                addLogEntry(logEntry, sessionId);

                // Return the response
                return response;

            } catch (error) {
                const endTime = performance.now();

                // Log error details with more information
                if (DEBUG_CONFIG.logErrors) {
                    errorData = {
                        name: error.name,
                        message: error.message,
                        stack: error.stack
                    };
                }

                // Try to extract HTTP status if available from the error/response
                let failedResponse = null;
                if (error.response) {
                    failedResponse = {
                        status: error.response.status,
                        statusText: error.response.statusText
                    };
                }

                // Create error log entry
                const logEntry = {
                    type: 'fetch-error',
                    method: request.method,
                    url: url,
                    request: requestData,
                    response: failedResponse,
                    error: errorData,
                    timing: DEBUG_CONFIG.logTiming ? {
                        duration: Math.round(endTime - startTime),
                        start: startTime,
                        end: endTime
                    } : null
                };

                addLogEntry(logEntry, sessionId);

                // Re-throw the error
                throw error;
            }
        })()
    );
});

// Handle service worker installation
self.addEventListener('install', event => {
    console.log('🔧 Fetch Debugger Service Worker installing...');
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('✅ Fetch Debugger Service Worker installed');
            return self.skipWaiting();
        })
    );
});

// Handle service worker activation
self.addEventListener('activate', event => {
    console.log('🔧 Fetch Debugger Service Worker activating...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('🗑️ Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('✅ Fetch Debugger Service Worker activated');
            return self.clients.claim();
        })
    );
});

// Handle messages from the main thread
self.addEventListener('message', event => {
    const { type, data } = event.data;
    const sessionId = data.sessionId || 'default';

    switch (type) {
        case 'GET_DEBUG_LOGS':
            const logs = logsBySession.get(sessionId) || [];
            event.ports[0].postMessage({
                type: 'DEBUG_LOGS',
                logs: logs,
                config: DEBUG_CONFIG
            });
            break;

        case 'CLEAR_DEBUG_LOGS':
            logsBySession.set(sessionId, []);
            event.ports[0].postMessage({
                type: 'LOGS_CLEARED',
                success: true
            });
            console.log('🗑️ Debug logs cleared for session:', sessionId);
            break;

        case 'UPDATE_CONFIG':
            Object.assign(DEBUG_CONFIG, data);
            event.ports[0].postMessage({
                type: 'CONFIG_UPDATED',
                config: DEBUG_CONFIG
            });
            console.log('⚙️ Debug config updated:', DEBUG_CONFIG);
            break;

        case 'GET_CONFIG':
            event.ports[0].postMessage({
                type: 'DEBUG_CONFIG',
                config: DEBUG_CONFIG
            });
            break;

        default:
            console.warn('Unknown message type:', type);
    }
});

console.log('🚀 Fetch Debugger Service Worker loaded');