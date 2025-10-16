// Service Worker communication and fetch debugging

let swRegistration = null;
let fetchDebuggerEnabled = true;
let fetchLogsUpdateInterval = null;

// Register service worker
export async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            console.log('Registering service worker for fetch debugging...');
            swRegistration = await navigator.serviceWorker.register('./sw.js');
            console.log('✅ Service worker registered for fetch debugging');

            startFetchLogsUpdate();

            swRegistration.addEventListener('updatefound', () => {
                console.log('🔄 Service worker update found');
            });

            if (swRegistration.waiting) {
                console.log('⏳ Service worker is waiting to activate');
            }

            return swRegistration;
        } catch (error) {
            console.error('❌ Service worker registration failed:', error);
        }
    } else {
        console.warn('⚠️ Service workers not supported in this browser');
        document.getElementById('fetch-logs').innerHTML = '<div style="color: #ff6b6b;">Service Workers not supported in this browser</div>';
    }
}

// Send message to service worker
export async function sendMessageToSW(message) {
    if (!swRegistration || !swRegistration.active) {
        console.warn('Service worker not ready');
        return null;
    }

    return new Promise((resolve) => {
        const messageChannel = new MessageChannel();
        messageChannel.port1.onmessage = (event) => {
            resolve(event.data);
        };
        swRegistration.active.postMessage(message, [messageChannel.port2]);
    });
}

// Get fetch logs from service worker
export async function getFetchLogs() {
    const response = await sendMessageToSW({ type: 'GET_DEBUG_LOGS' });
    return response ? response.logs : [];
}

// Clear fetch logs
export async function clearFetchLogs() {
    await sendMessageToSW({ type: 'CLEAR_DEBUG_LOGS' });
    updateFetchLogsDisplay();
    console.log('🗑️ Fetch logs cleared');
}

// Toggle fetch debugger
export async function toggleFetchDebugger() {
    fetchDebuggerEnabled = !fetchDebuggerEnabled;
    const config = await sendMessageToSW({ type: 'GET_CONFIG' });
    await sendMessageToSW({
        type: 'UPDATE_CONFIG',
        data: { enabled: fetchDebuggerEnabled }
    });

    const status = fetchDebuggerEnabled ? 'enabled' : 'disabled';
    console.log(`🔧 Fetch debugger ${status}`);

    if (!fetchDebuggerEnabled) {
        document.getElementById('fetch-logs').innerHTML = '<div style="color: #ffa500;">Fetch debugger is disabled</div>';
        if (fetchLogsUpdateInterval) {
            clearInterval(fetchLogsUpdateInterval);
        }
    } else {
        startFetchLogsUpdate();
    }
}

// Download logs as JSON
export async function downloadFetchLogs() {
    const logs = await getFetchLogs();
    const dataStr = JSON.stringify(logs, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = `fetch-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();

    console.log('📥 Fetch logs downloaded');
}

// Update fetch logs display
export async function updateFetchLogsDisplay() {
    if (!fetchDebuggerEnabled) return;

    try {
        const logs = await getFetchLogs();
        const fetchLogsDiv = document.getElementById('fetch-logs');

        if (logs.length === 0) {
            fetchLogsDiv.innerHTML = '<div>No fetch requests logged yet...</div>';
            return;
        }

        const logsHtml = logs.slice(0, 20).map(log => {
            const timestamp = new Date(log.timestamp).toLocaleTimeString();
            const method = log.method || 'GET';
            const url = log.url ? new URL(log.url).pathname : 'unknown';

            let status, statusText;
            if (log.response?.status) {
                status = log.response.status;
                statusText = log.response.statusText ? ` ${log.response.statusText}` : '';
            } else if (log.error) {
                status = 'FETCH_ERROR';
                statusText = log.error.message ? `: ${log.error.message}` : '';
            } else {
                status = 'PENDING';
                statusText = '';
            }

            const duration = log.timing?.duration || '?';

            const statusColor = log.error ? '#ff6b6b' :
                (typeof status === 'number' && status >= 400) ? '#ffa500' :
                    (typeof status === 'number' && status >= 200 && status < 300) ? '#51cf66' : '#74c0fc';

            return `
                <div style="margin-bottom: 4px; padding: 2px 0; border-bottom: 1px solid #333;">
                    <span style="color: #74c0fc;">${timestamp}</span>
                    <span style="color: #ffd43b;">${method}</span>
                    <span style="color: #fff;">${url}</span>
                    <span style="color: ${statusColor};">${status}${statusText}</span>
                    <span style="color: #aaa;">(${duration}ms)</span>
                </div>
            `;
        }).join('');

        fetchLogsDiv.innerHTML = logsHtml;
        fetchLogsDiv.scrollTop = 0;
    } catch (error) {
        console.error('Error updating fetch logs display:', error);
    }
}

// Start periodic updates of fetch logs
export function startFetchLogsUpdate() {
    if (fetchLogsUpdateInterval) {
        clearInterval(fetchLogsUpdateInterval);
    }

    fetchLogsUpdateInterval = setInterval(updateFetchLogsDisplay, 2000);
    updateFetchLogsDisplay();
}
