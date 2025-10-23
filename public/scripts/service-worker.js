// Service Worker communication and fetch debugging

let swRegistration = null;
let fetchDebuggerEnabled = true;
let fetchLogsUpdateInterval = null;

// Register service worker
export async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      console.log("Registering service worker for fetch debugging...");
      swRegistration = await navigator.serviceWorker.register("./sw.js");
      console.log("✅ Service worker registered for fetch debugging");

      startFetchLogsUpdate();

      swRegistration.addEventListener("updatefound", () => {
        console.log("🔄 Service worker update found");
      });

      if (swRegistration.waiting) {
        console.log("⏳ Service worker is waiting to activate");
      }

      return swRegistration;
    } catch (error) {
      console.error("❌ Service worker registration failed:", error);
    }
  } else {
    console.warn("⚠️ Service workers not supported in this browser");
    document.getElementById("fetch-logs").innerHTML =
      '<div style="color: #ff6b6b;">Service Workers not supported in this browser</div>';
  }
}

// Send message to service worker
export async function sendMessageToSW(message) {
  if (!swRegistration || !swRegistration.active) {
    console.warn("Service worker not ready");
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
  const response = await sendMessageToSW({ type: "GET_DEBUG_LOGS" });
  return response ? response.logs : [];
}

// Clear fetch logs
export async function clearFetchLogs() {
  await sendMessageToSW({ type: "CLEAR_DEBUG_LOGS" });
  expandedLogs.clear(); // Clear expanded state when clearing logs
  updateFetchLogsDisplay();
  console.log("🗑️ Fetch logs cleared");
}

// Toggle fetch debugger
export async function toggleFetchDebugger() {
  fetchDebuggerEnabled = !fetchDebuggerEnabled;
  const config = await sendMessageToSW({ type: "GET_CONFIG" });
  await sendMessageToSW({
    type: "UPDATE_CONFIG",
    data: { enabled: fetchDebuggerEnabled },
  });

  const status = fetchDebuggerEnabled ? "enabled" : "disabled";
  console.log(`🔧 Fetch debugger ${status}`);

  if (!fetchDebuggerEnabled) {
    document.getElementById("fetch-logs").innerHTML =
      '<div style="color: #ffa500;">Fetch debugger is disabled</div>';
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
  const dataUri =
    "data:application/json;charset=utf-8," + encodeURIComponent(dataStr);

  const exportFileDefaultName = `fetch-logs-${new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/:/g, "-")}.json`;

  const linkElement = document.createElement("a");
  linkElement.setAttribute("href", dataUri);
  linkElement.setAttribute("download", exportFileDefaultName);
  linkElement.click();

  console.log("📥 Fetch logs downloaded");
}

// Format JSON for display
function formatJSON(obj) {
  if (!obj) return "null";
  try {
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return String(obj);
  }
}

// Store expanded state of logs
let expandedLogs = new Set();

// Toggle log details visibility
window.toggleLogDetails = function(logId) {
  const detailsDiv = document.getElementById(`log-details-${logId}`);
  const toggleIcon = document.getElementById(`toggle-icon-${logId}`);

  if (detailsDiv) {
    const isHidden = detailsDiv.style.display === 'none';
    detailsDiv.style.display = isHidden ? 'block' : 'none';
    toggleIcon.textContent = isHidden ? '▼' : '▶';

    // Update expanded state
    if (isHidden) {
      expandedLogs.add(logId);
    } else {
      expandedLogs.delete(logId);
    }
  }
};

// Update fetch logs display
export async function updateFetchLogsDisplay() {
  if (!fetchDebuggerEnabled) return;

  try {
    const logs = await getFetchLogs();
    const fetchLogsDiv = document.getElementById("fetch-logs");

    if (logs.length === 0) {
      fetchLogsDiv.innerHTML = "<div>No fetch requests logged yet...</div>";
      return;
    }

    // Store current scroll position
    const currentScrollTop = fetchLogsDiv.scrollTop;

    const logsHtml = logs
      .slice(0, 50)
      .map((log) => {
        const timestamp = new Date(log.timestamp).toLocaleTimeString();
        const method = log.method || "GET";
        const url = log.url ? new URL(log.url).pathname : "unknown";
        const fullUrl = log.url || "unknown";

        let status, statusText;
        if (log.response?.status) {
          status = log.response.status;
          statusText = log.response.statusText
            ? ` ${log.response.statusText}`
            : "";
        } else if (log.error) {
          status = "FETCH_ERROR";
          statusText = log.error.message ? `: ${log.error.message}` : "";
        } else {
          status = "PENDING";
          statusText = "";
        }

        const duration = log.timing?.duration || "?";

        const statusColor = log.error
          ? "#ff6b6b"
          : typeof status === "number" && status >= 400
          ? "#ffa500"
          : typeof status === "number" && status >= 200 && status < 300
          ? "#51cf66"
          : "#74c0fc";

        // Check if this log is expanded
        const isExpanded = expandedLogs.has(log.id);
        const displayStyle = isExpanded ? 'block' : 'none';
        const iconText = isExpanded ? '▼' : '▶';

        // Create detailed view
        const requestHeaders = formatJSON(log.request?.headers || {});
        const requestBody = log.request?.body || "(empty)";
        const responseHeaders = formatJSON(log.response?.headers || {});
        const responseBody = log.response?.body || "(empty)";
        const errorDetails = log.error ? formatJSON(log.error) : null;

        return `
                <div style="margin-bottom: 8px; border: 1px solid #333; border-radius: 4px; background-color: #1a1a1a;">
                    <div onclick="toggleLogDetails('${log.id}')" style="padding: 8px; cursor: pointer; user-select: none; transition: background-color 0.2s;"
                         onmouseover="this.style.backgroundColor='#252525'"
                         onmouseout="this.style.backgroundColor='#1a1a1a'">
                        <span id="toggle-icon-${log.id}" style="color: #888; margin-right: 8px;">${iconText}</span>
                        <span style="color: #74c0fc;">${timestamp}</span>
                        <span style="color: #ffd43b; margin-left: 8px; font-weight: bold;">${method}</span>
                        <span style="color: #fff; margin-left: 8px;">${url}</span>
                        <span style="color: ${statusColor}; margin-left: 8px; font-weight: bold;">${status}${statusText}</span>
                        <span style="color: #aaa; margin-left: 8px;">(${duration}ms)</span>
                    </div>
                    <div id="log-details-${log.id}" style="display: ${displayStyle}; padding: 12px; border-top: 1px solid #333; background-color: #0d0d0d;">
                        <div style="margin-bottom: 12px;">
                            <div style="color: #6c89e9; font-weight: bold; margin-bottom: 4px;">📋 Full URL:</div>
                            <pre style="background-color: #1a1a1a; padding: 8px; border-radius: 4px; overflow-x: auto; margin: 0; color: #51cf66; font-size: 11px;">${fullUrl}</pre>
                        </div>

                        <div style="margin-bottom: 12px;">
                            <div style="color: #ffd43b; font-weight: bold; margin-bottom: 4px;">📤 Request Headers:</div>
                            <pre style="background-color: #1a1a1a; padding: 8px; border-radius: 4px; overflow-x: auto; margin: 0; color: #aaa; font-size: 11px;">${requestHeaders}</pre>
                        </div>

                        <div style="margin-bottom: 12px;">
                            <div style="color: #ffd43b; font-weight: bold; margin-bottom: 4px;">📤 Request Body:</div>
                            <pre style="background-color: #1a1a1a; padding: 8px; border-radius: 4px; overflow-x: auto; margin: 0; color: #fff; font-size: 11px; max-height: 300px; overflow-y: auto;">${requestBody}</pre>
                        </div>

                        ${log.response ? `
                        <div style="margin-bottom: 12px;">
                            <div style="color: #51cf66; font-weight: bold; margin-bottom: 4px;">📥 Response Headers:</div>
                            <pre style="background-color: #1a1a1a; padding: 8px; border-radius: 4px; overflow-x: auto; margin: 0; color: #aaa; font-size: 11px;">${responseHeaders}</pre>
                        </div>

                        <div style="margin-bottom: 12px;">
                            <div style="color: #51cf66; font-weight: bold; margin-bottom: 4px;">📥 Response Body:</div>
                            <pre style="background-color: #1a1a1a; padding: 8px; border-radius: 4px; overflow-x: auto; margin: 0; color: #fff; font-size: 11px; max-height: 300px; overflow-y: auto;">${responseBody}</pre>
                        </div>
                        ` : ''}

                        ${errorDetails ? `
                        <div style="margin-bottom: 12px;">
                            <div style="color: #ff6b6b; font-weight: bold; margin-bottom: 4px;">❌ Error Details:</div>
                            <pre style="background-color: #1a1a1a; padding: 8px; border-radius: 4px; overflow-x: auto; margin: 0; color: #ff6b6b; font-size: 11px;">${errorDetails}</pre>
                        </div>
                        ` : ''}

                        ${log.timing ? `
                        <div>
                            <div style="color: #74c0fc; font-weight: bold; margin-bottom: 4px;">⏱️ Timing:</div>
                            <div style="color: #aaa; font-size: 11px;">
                                <span>Duration: ${log.timing.duration}ms</span>
                            </div>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;
      })
      .join("");

    fetchLogsDiv.innerHTML = logsHtml;

    // Restore scroll position
    fetchLogsDiv.scrollTop = currentScrollTop;
  } catch (error) {
    console.error("Error updating fetch logs display:", error);
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
