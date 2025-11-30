fetch("/api/statistics")
  .then((response) => response.json())
  .then((data) => {
    document.getElementById("activeRequests").innerText = data.activeRequests;
    document.getElementById("totalRequests").innerText = data.totalRequests;
  });

function updateGenerateKeyButtonState() {
  const generateKeyBtn = document.getElementById("generateKeyBtn");
  const storedKey = localStorage.getItem("key");

  // Check if key is valid (not null, undefined, or the string "undefined")
  const isValidKey =
    storedKey && storedKey !== "undefined" && storedKey.trim() !== "";

  if (isValidKey) {
    generateKeyBtn.disabled = true;
    generateKeyBtn.innerText = "Key Already Generated";
  } else {
    generateKeyBtn.disabled = false;
    generateKeyBtn.innerText = "Generate New Key";
    // Clear invalid key from localStorage and reset display
    if (storedKey && (storedKey === "undefined" || storedKey.trim() === "")) {
      localStorage.removeItem("key");
      document.getElementById("keyDisplay").innerText = "Not set";
    }
  }
}

// Function to check if user can watch ad and update button state
async function updateAdButtonState() {
  const watchAdBtn = document.getElementById("watchAdBtn");
  const storedKey = localStorage.getItem("key");
  const isValidKey =
    storedKey &&
    storedKey !== "undefined" &&
    storedKey !== "Undefined" &&
    storedKey.trim() !== "";

  if (!isValidKey) {
    watchAdBtn.disabled = false;
    watchAdBtn.innerText = "Watch Ad for 500 Credits/Requests";
    return;
  }

  try {
    const response = await fetch("/api/check-key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: storedKey,
      }),
    });
    const data = await response.json();

    if (data && data.lastAdViewedDate !== undefined) {
      const lastViewed = data.lastAdViewedDate;
      const now = Date.now();
      const timeSinceLastAd = now - lastViewed;
      const timeUntilNextAd = 43200000 - timeSinceLastAd; // 12 hours in ms

      // If last viewed is 0 (never watched) or more than 12 hours ago
      if (lastViewed === 0 || timeSinceLastAd >= 43200000) {
        watchAdBtn.disabled = false;
        watchAdBtn.innerText = "Watch Ad for 500 Credits/Requests";
      } else {
        // User watched an ad less than 12 hours ago
        watchAdBtn.disabled = true;
        const hoursLeft = Math.ceil(timeUntilNextAd / 3600000);
        watchAdBtn.innerText = `Wait ${hoursLeft}h to watch another ad`;
      }
    }
  } catch (error) {
    console.error("Error checking ad status:", error);
  }
}

document
  .getElementById("generateKeyBtn")
  .addEventListener("click", async function () {
    const response = await fetch("/api/make-key");
    const data = await response.json();
    localStorage.setItem("key", data.key);
    document.getElementById("keyDisplay").innerText = data.key;
    document.getElementById("credits").innerText = data.balance;
    // Update ad button state after generating key
    await updateAdButtonState();
  });

document
  .getElementById("checkKeyBtn")
  .addEventListener("click", async function () {
    const storedKey = localStorage.getItem("key");
    const isValidKey =
      storedKey &&
      storedKey !== "undefined" &&
      storedKey !== "Undefined" &&
      storedKey.trim() !== "";

    if (!isValidKey) {
      alert("You need to generate a key first!");
      if (
        storedKey &&
        (storedKey === "undefined" ||
          storedKey === "Undefined" ||
          storedKey.trim() === "")
      ) {
        localStorage.removeItem("key");
        document.getElementById("keyDisplay").innerText = "Not set";
        document.getElementById("credits").innerText = "0";
        updateGenerateKeyButtonState();
      }
      return;
    }
    const response = await fetch("/api/check-key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: storedKey,
      }),
    });
    const data = await response.json();
    document.getElementById("credits").innerText = data.balance;
    // Update ad button state after checking key
    await updateAdButtonState();
  });

document
  .getElementById("watchAdBtn")
  .addEventListener("click", async function () {
    const storedKey = localStorage.getItem("key");
    const isValidKey =
      storedKey &&
      storedKey !== "undefined" &&
      storedKey !== "Undefined" &&
      storedKey.trim() !== "";

    if (!isValidKey) {
      alert("You need to generate a key first!");
      if (
        storedKey &&
        (storedKey === "undefined" ||
          storedKey === "Undefined" ||
          storedKey.trim() === "")
      ) {
        localStorage.removeItem("key");
        document.getElementById("keyDisplay").innerText = "Not set";
        document.getElementById("credits").innerText = "0";
        updateGenerateKeyButtonState();
      }
      return;
    }
    // Only redirect if button is not disabled
    if (!this.disabled) {
      window.location.href = "/redirect.html";
    }
  });

// holy autism

let messages = [
  // music type shit

  "BEG FORGIVENESS",
];

document.getElementById("other").innerHTML = 
messages[Math.floor(Math.random() * messages.length)];

setTimeout(() => {
  const adSectionStyle = getComputedStyle(document.getElementById("adSection"));
  if (adSectionStyle.display === "none") {
    alert(
      "please turn off your ad blocker, there aint even ads on this page vro, just when you click the button"
    );
  }
}, 500);

// Load and display key on page load if it exists
window.addEventListener("DOMContentLoaded", async function () {
  const storedKey = localStorage.getItem("key");

  
  let isValidKey =
    storedKey && storedKey !== "undefined" && storedKey.trim() !== "";

  isValidKey = isValidKey || storedKey != null

  if (isValidKey) {
    document.getElementById("keyDisplay").innerText = storedKey;

    // Auto-check the key balance
    try {
      const response = await fetch("/api/check-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key: storedKey,
        }),
      });
      const data = await response.json();
      if (data && data.balance !== undefined) {
        document.getElementById("credits").innerText = data.balance;
      }
    } catch (error) {
      console.error("Error loading key status:", error);
    }
  } else {
    // Clear invalid key and reset display
    if (storedKey && (storedKey === "undefined" || storedKey.trim() === "")) {
      localStorage.removeItem("key");
    }
    document.getElementById("keyDisplay").innerText = "Not set";
    document.getElementById("credits").innerText = "0";
  }

  // Update button states on page load
  updateGenerateKeyButtonState();
  await updateAdButtonState();
});
