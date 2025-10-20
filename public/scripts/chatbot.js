initializeChatbot();

function initializeChatbot() {
    const chatbotContainer = document.getElementById('chatbot-container');
    const chatbotToggle = document.getElementById('chatbot-toggle');
    const chatbotClose = document.getElementById('chatbot-close');
    const chatbotMinimize = document.getElementById('chatbot-minimize');
    const chatbotInput = document.getElementById('chatbot-input');
    const chatbotSend = document.getElementById('chatbot-send');
    const chatbotMessages = document.getElementById('chatbot-messages');
    const chatbotNotification = document.getElementById('chatbot-notification');

    let isMinimized = false;
    let messages = []
    let messageCount = 0;

    function showWelcomeMessage() {
        if (chatbotMessages.children.length === 0) {
            addMessage("Tell my thy issues and I shall tell you how to debug them", 'bot');
        }
    }

    // Add message to chat
    function addMessage(text, sender) {
        messages.push({ text, sender });
        const messageDiv = document.createElement('div');
        messageDiv.className = `chatbot-message ${sender}`;

        const messageContent = document.createElement('div');
        messageContent.textContent = text;

        const timestamp = document.createElement('div');
        timestamp.className = 'chatbot-message-timestamp';
        timestamp.textContent = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        messageDiv.appendChild(messageContent);
        messageDiv.appendChild(timestamp);
        chatbotMessages.appendChild(messageDiv);

        // Scroll to bottom
        chatbotMessages.scrollTop = chatbotMessages.scrollHeight;

        // Update notification count
        if (sender === 'bot') {
            messageCount++;
            chatbotNotification.textContent = messageCount;
            chatbotNotification.style.display = 'block';
        }
    }

    // Get random predefined response
    function getRandomResponse() {
        return predefinedResponses[Math.floor(Math.random() * predefinedResponses.length)];
    }

    // Send message
    async function sendMessage() {
        const message = chatbotInput.value.trim();
        if (message === '') return;

        addMessage(message, 'user');

        chatbotInput.value = '';

        let prompt =  `
        You are a debugger for the Composite Website.

        These are the users settings:

        Latest 10 console logs:
       ${window.logs.slice(-10).join('\n')}

       Model: ${document.getElementById('model').value}}
       Engine: ${document.getElementById('engine').value}
       Prompt: ${document.getElementById('prefix-prompt').value}

       Guide for Debugging ( use sections of this to help the user ):

       For 429s, if the engine is Yuzu or Yuzu auto, its due to DeepInfra's rate limits.
       
       For general errors such as models not responding, tell the user to give you the logs from the console and fetch logs.

       For errors where theres chunks / text response visible in Janitor.AI's error message, question if the user has text streaming on, and if they have it off, and if they have it on.

       For quality or general generation errors in Yuzu Auto, ask the user to give you the console logs in the debug section.

       If you cannot solve a issue ( you tried but it keeps not working ), direct the user to the Discord ( tell them it is at the bottom of the page ) to get more help.


       Conversation messages:
       ${messages.map(message => message.content).join('\n')}

       Respond to the newest message:
       ${messages[messages.length - 1]['content']}

        `

        await fetch("https://text.pollinations.ai/" + prompt).then(response => response.text()).then(response => addMessage(response, 'bot'));

    }

    // Toggle chatbot visibility
    function toggleChatbot() {
        if (chatbotContainer.classList.contains('chatbot-hidden')) {
            // Opening chat
            chatbotContainer.classList.remove('chatbot-hidden');
            chatbotContainer.classList.add('chatbot-container-visible');
            chatbotToggle.classList.add('chatbot-toggle-hidden');
            showWelcomeMessage();
        } else {
            // Closing chat
            closeChatbot();
        }
    }

    // Close chatbot
    function closeChatbot() {
        chatbotContainer.classList.add('chatbot-hidden');
        chatbotContainer.classList.remove('chatbot-container-visible');
        chatbotToggle.classList.remove('chatbot-toggle-hidden');
        chatbotToggle.classList.add('chatbot-toggle-visible');
        messageCount = 0;
        chatbotNotification.style.display = 'none';
    }

    function minimizeChatbot() {
        if (isMinimized) {
            chatbotContainer.style.height = '500px';
            chatbotMessages.style.display = 'block';
            chatbotInput.style.display = 'flex';
            chatbotMinimize.innerHTML = '<i class="fas fa-minus"></i>';
            chatbotMinimize.title = 'Minimize';
            isMinimized = false;
        } else {
            // Minimize
            chatbotContainer.style.height = 'auto';
            chatbotMessages.style.display = 'none';
            chatbotInput.style.display = 'none';
            chatbotMinimize.innerHTML = '<i class="fas fa-plus"></i>';
            chatbotMinimize.title = 'Maximize';
            isMinimized = true;
        }
    }

    if (chatbotToggle) {
        chatbotToggle.addEventListener('click', toggleChatbot);
    }

    if (chatbotClose) {
        chatbotClose.addEventListener('click', closeChatbot);
    }

    if (chatbotMinimize) {
        chatbotMinimize.addEventListener('click', minimizeChatbot);
    }

    if (chatbotSend) {
        chatbotSend.addEventListener('click', sendMessage);
    }

    if (chatbotInput) {
        chatbotInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });

        chatbotInput.addEventListener('focus', function() {
            messageCount = 0;
            chatbotNotification.style.display = 'none';
        });
    }
    window.chatbot = {
        toggle: toggleChatbot,
        send: sendMessage,
        addMessage: addMessage,
        close: closeChatbot,
        minimize: minimizeChatbot
    };

    console.log('Chatbot initialized successfully!');
}
