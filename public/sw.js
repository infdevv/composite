// Service Worker for Fetch Debugging Middleware
const SW_VERSION = 'v1.0.0';
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

// In-memory log storage
let debugLogs = [];

// Helper function to check if URL should be intercepted
function shouldIntercept(url) {
    if (!DEBUG_CONFIG.enabled) return false;

    return DEBUG_CONFIG.interceptPatterns.some(pattern =>
        url.includes(pattern)
    );
}

// Helper function to sanitize headers (remove sensitive data)
function sanitizeHeaders(headers) {
    const sanitized = {};
    if (!headers) return sanitized;

    for (const [key, value] of headers.entries()) {
        const lowerKey = key.toLowerCase();
        if (DEBUG_CONFIG.logHeaders.includes(lowerKey)) {
            // Partially mask authorization headers
            if (lowerKey === 'authorization' && value.length > 10) {
                sanitized[key] = value.substring(0, 10) + '***';
            } else {
                sanitized[key] = value;
            }
        }
    }

    return sanitized;
}

// Helper function to sanitize response headers
function sanitizeResponseHeaders(headers) {
    const sanitized = {};
    if (!headers) return sanitized;

    for (const [key, value] of headers.entries()) {
        const lowerKey = key.toLowerCase();
        if (DEBUG_CONFIG.logResponseHeaders.includes(lowerKey)) {
            sanitized[key] = value;
        }
    }

    return sanitized;
}

// Helper function to add log entry
function addLogEntry(entry) {
    if (!DEBUG_CONFIG.enabled) return;

    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        id: `${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
        ...entry
    };

    debugLogs.unshift(logEntry);

    // Keep only the most recent entries
    if (debugLogs.length > DEBUG_CONFIG.maxLogEntries) {
        debugLogs = debugLogs.slice(0, DEBUG_CONFIG.maxLogEntries);
    }

    // Also log to console for immediate debugging
    console.group(`🔍 Fetch Debug: ${entry.method} ${entry.url}`);
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
                const text = await cloned.text();
                // Only log first 500 characters to avoid huge logs
                body = text.length > 500 ? text.substring(0, 500) + '...[truncated]' : text;
            } catch (e) {
                body = '[Could not read body]';
            }
        }

        return {
            url: isRequest ? cloned.url : undefined,
            method: isRequest ? cloned.method : undefined,
            headers: isRequest ? sanitizeHeaders(cloned.headers) : sanitizeResponseHeaders(cloned.headers),
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

                addLogEntry(logEntry);

                // Return the response
                return response;

            } catch (error) {
                const endTime = performance.now();

                // Log error details
                if (DEBUG_CONFIG.logErrors) {
                    errorData = {
                        name: error.name,
                        message: error.message,
                        stack: error.stack
                    };
                }

                // Create error log entry
                const logEntry = {
                    type: 'fetch-error',
                    method: request.method,
                    url: url,
                    request: requestData,
                    error: errorData,
                    timing: DEBUG_CONFIG.logTiming ? {
                        duration: Math.round(endTime - startTime),
                        start: startTime,
                        end: endTime
                    } : null
                };

                addLogEntry(logEntry);

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

    switch (type) {
        case 'GET_DEBUG_LOGS':
            event.ports[0].postMessage({
                type: 'DEBUG_LOGS',
                logs: debugLogs,
                config: DEBUG_CONFIG
            });
            break;

        case 'CLEAR_DEBUG_LOGS':
            debugLogs = [];
            event.ports[0].postMessage({
                type: 'LOGS_CLEARED',
                success: true
            });
            console.log('🗑️ Debug logs cleared');
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