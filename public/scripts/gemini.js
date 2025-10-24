
const API_KEY_STORAGE = 'gemini_api_key';

// Load API key on page load
function loadAPIKey() {
    const savedKey = localStorage.getItem(API_KEY_STORAGE);
    if (savedKey) {
        document.getElementById('api-key-input').value = savedKey;
        updateKeyStatus(savedKey);
        // Set up the getter function with the saved key
        window.getGeminiAPIKey = function() { return savedKey; };
    } else {
        // Initialize with empty function that returns from localStorage
        window.getGeminiAPIKey = function() { return localStorage.getItem(API_KEY_STORAGE) || ''; };
    }
}

// Update key status display
function updateKeyStatus(key) {
    const keyElement = document.getElementById('gemini-key-status');
    if (key && key.length > 0) {
        // Show first 8 and last 4 characters
        const masked = key.substring(0, 8) + '...' + key.substring(key.length - 4);
        keyElement.textContent = masked;
        keyElement.style.color = '#7be77b';
    } else {
        keyElement.textContent = '[Not Set]';
        keyElement.style.color = '#f03a80';
    }
}
document.getElementById('api-key-input').addEventListener('input', function() {
     const newValue = this.value;
     localStorage.setItem(API_KEY_STORAGE, newValue);
     // Use a closure to capture the value properly
     window.getGeminiAPIKey = function() { return localStorage.getItem(API_KEY_STORAGE) || ''; };
     updateKeyStatus(newValue);

});

loadAPIKey();

const vods = [
"https://youtube.com/embed/6Xp-zh0nIf0",
"https://youtube.com/embed/xBNOkh2EZoc"
]

let vod = vods[Math.floor(Math.random() * vods.length)];

const player = document.getElementById('pippa');

player.src = vod;