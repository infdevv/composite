/**
 * Plugin Parser for processing message modifications based on plugin configurations
 * Handles trigger groups, stages, conditions, actions, and templates
 */

class PluginParser {
    constructor() {
        this.messageCount = 0;
        this.variables = {};
        this.stageHistory = new Map();
    }

    /**
     * Parse and execute a plugin on a set of messages
     * @param {Object} plugin - The plugin configuration object
     * @param {Array} messages - Array of message objects
     * @returns {Array} Modified messages array
     */
    parsePlugin(plugin, messages) {
        if (!plugin || !Array.isArray(messages)) {
            return messages;
        }

        this.messageCount = messages.length;
        this.variables = { ...plugin.variables };

        // Check if plugin should trigger
        if (!this.shouldTrigger(plugin, messages)) {
            return messages;
        }

        // Execute plugin actions
        return this.executeActions(plugin, messages);
    }

    /**
     * Determine if the plugin should trigger based on trigger groups and conditions
     * @param {Object} plugin - The plugin configuration
     * @param {Array} messages - Array of messages
     * @returns {boolean} Whether the plugin should trigger
     */
    shouldTrigger(plugin, messages) {
        // Check trigger groups
        if (plugin.triggerGroups && plugin.triggerGroups.length > 0) {
            for (const triggerGroup of plugin.triggerGroups) {
                if (this.evaluateTriggerGroup(triggerGroup, messages)) {
                    return true;
                }
            }
            return false;
        }

        // Check legacy logic trigger
        if (plugin.logic && plugin.logic.trigger) {
            return this.evaluateTrigger(plugin.logic.trigger, messages);
        }

        return false;
    }

    /**
     * Evaluate a trigger group
     * @param {Object} triggerGroup - The trigger group configuration
     * @param {Array} messages - Array of messages
     * @returns {boolean} Whether the trigger group should activate
     */
    evaluateTriggerGroup(triggerGroup, messages) {
        switch (triggerGroup.type) {
            case 'RANDOM_CHANCE':
                return Math.random() * 100 < triggerGroup.chance;

            case 'KEYWORD':
                return this.checkKeywords(triggerGroup.keywords, messages);

            case 'REGEX':
                return this.checkRegex(triggerGroup.regex, triggerGroup.flags, messages);

            case 'MESSAGE_COUNT':
                return this.evaluateMessageCount(triggerGroup.countOperator, triggerGroup.countValue);

            default:
                return false;
        }
    }

    /**
     * Evaluate legacy trigger format
     * @param {Object} trigger - The trigger configuration
     * @param {Array} messages - Array of messages
     * @returns {boolean} Whether the trigger should activate
     */
    evaluateTrigger(trigger, messages) {
        switch (trigger.type) {
            case 'RANDOM_CHANCE':
                return Math.random() * 100 < trigger.chance;

            case 'KEYWORD':
                return this.checkKeywords(trigger.keywords, messages);

            default:
                return false;
        }
    }

    /**
     * Check if any keywords are found in messages
     * @param {Array} keywords - Array of keywords to search for
     * @param {Array} messages - Array of messages
     * @returns {boolean} Whether keywords were found
     */
    checkKeywords(keywords, messages) {
        if (!keywords || keywords.length === 0) return false;

        const lastMessage = messages[messages.length - 1];
        if (!lastMessage || !lastMessage.content) return false;

        const content = lastMessage.content.toLowerCase();
        return keywords.some(keyword => content.includes(keyword.toLowerCase()));
    }

    /**
     * Check if regex pattern matches in messages
     * @param {string} pattern - Regex pattern
     * @param {string} flags - Regex flags
     * @param {Array} messages - Array of messages
     * @returns {boolean} Whether regex matches
     */
    checkRegex(pattern, flags, messages) {
        if (!pattern) return false;

        try {
            const regex = new RegExp(pattern, flags || 'gi');
            const lastMessage = messages[messages.length - 1];
            if (!lastMessage || !lastMessage.content) return false;

            return regex.test(lastMessage.content);
        } catch (error) {
            console.error('Invalid regex pattern:', pattern, error);
            return false;
        }
    }

    /**
     * Evaluate message count condition
     * @param {string} operator - Comparison operator (>, <, =, >=, <=)
     * @param {number} value - Value to compare against
     * @returns {boolean} Whether condition is met
     */
    evaluateMessageCount(operator, value) {
        switch (operator) {
            case '>':
                return this.messageCount > value;
            case '<':
                return this.messageCount < value;
            case '=':
            case '==':
                return this.messageCount === value;
            case '>=':
                return this.messageCount >= value;
            case '<=':
                return this.messageCount <= value;
            default:
                return false;
        }
    }

    /**
     * Execute plugin actions on messages
     * @param {Object} plugin - The plugin configuration
     * @param {Array} messages - Array of messages
     * @returns {Array} Modified messages array
     */
    executeActions(plugin, messages) {
        let modifiedMessages = [...messages];

        // Execute stage-based actions
        if (plugin.stages && plugin.stages.length > 0) {
            modifiedMessages = this.executeStages(plugin.stages, modifiedMessages);
        }

        // Execute default actions
        if (plugin.actions && plugin.actions.default) {
            modifiedMessages = this.processActions(plugin.actions.default, modifiedMessages, plugin);
        }

        // Execute legacy logic actions
        if (plugin.logic && plugin.logic.actions) {
            modifiedMessages = this.processActions(plugin.logic.actions, modifiedMessages, plugin);
        }

        return modifiedMessages;
    }

    /**
     * Execute stage-based logic
     * @param {Array} stages - Array of stage configurations
     * @param {Array} messages - Array of messages
     * @returns {Array} Modified messages array
     */
    executeStages(stages, messages) {
        let modifiedMessages = [...messages];

        for (const stage of stages) {
            if (this.shouldExecuteStage(stage, modifiedMessages)) {
                modifiedMessages = this.processActions(stage.actions, modifiedMessages, { stages, templates: [] });
            }
        }

        return modifiedMessages;
    }

    /**
     * Determine if a stage should execute
     * @param {Object} stage - Stage configuration
     * @param {Array} messages - Array of messages
     * @returns {boolean} Whether stage should execute
     */
    shouldExecuteStage(stage, messages) {
        // Check stage chance
        if (stage.chance && Math.random() * 100 >= stage.chance) {
            return false;
        }

        // Check stage keywords
        if (stage.keywords && stage.keywords.length > 0) {
            return this.checkKeywords(stage.keywords, messages);
        }

        return true;
    }

    /**
     * Process an array of actions
     * @param {Array} actions - Array of action configurations
     * @param {Array} messages - Array of messages
     * @param {Object} plugin - Full plugin configuration for context
     * @returns {Array} Modified messages array
     */
    processActions(actions, messages, plugin) {
        if (!Array.isArray(actions)) return messages;

        let modifiedMessages = [...messages];

        for (const action of actions) {
            modifiedMessages = this.executeAction(action, modifiedMessages, plugin);
        }

        return modifiedMessages;
    }

    /**
     * Execute a single action
     * @param {Object} action - Action configuration
     * @param {Array} messages - Array of messages
     * @param {Object} plugin - Full plugin configuration for context
     * @returns {Array} Modified messages array
     */
    executeAction(action, messages, plugin) {
        if (!action || !action.type || messages.length === 0) {
            return messages;
        }

        const modifiedMessages = [...messages];

        switch (action.type) {
            case 'ADD_TO_LAST_USER':
                return this.addToLastUser(action, modifiedMessages);

            case 'ADD_TO_LAST_ASSISTANT':
                return this.addToLastAssistant(action, modifiedMessages);

            case 'PREPEND_TO_LAST_USER':
                return this.prependToLastUser(action, modifiedMessages);

            case 'REPLACE_LAST_USER':
                return this.replaceLastUser(action, modifiedMessages);

            case 'ADD_NEW_MESSAGE':
                return this.addNewMessage(action, modifiedMessages);

            case 'EXECUTE_TEMPLATE':
                return this.executeTemplate(action, modifiedMessages, plugin);

            default:
                console.warn('Unknown action type:', action.type);
                return modifiedMessages;
        }
    }

    /**
     * Add content to the last user message
     * @param {Object} action - Action configuration
     * @param {Array} messages - Array of messages
     * @returns {Array} Modified messages array
     */
    addToLastUser(action, messages) {
        const lastUserIndex = this.findLastUserMessageIndex(messages);
        if (lastUserIndex === -1) return messages;

        const content = this.getContentFromPool(action.pool);
        if (content) {
            messages[lastUserIndex].content += ' ' + content;
        }

        return messages;
    }

    /**
     * Add content to the last assistant message
     * @param {Object} action - Action configuration
     * @param {Array} messages - Array of messages
     * @returns {Array} Modified messages array
     */
    addToLastAssistant(action, messages) {
        const lastAssistantIndex = this.findLastAssistantMessageIndex(messages);
        if (lastAssistantIndex === -1) return messages;

        const content = this.getContentFromPool(action.pool);
        if (content) {
            messages[lastAssistantIndex].content += ' ' + content;
        }

        return messages;
    }

    /**
     * Prepend content to the last user message
     * @param {Object} action - Action configuration
     * @param {Array} messages - Array of messages
     * @returns {Array} Modified messages array
     */
    prependToLastUser(action, messages) {
        const lastUserIndex = this.findLastUserMessageIndex(messages);
        if (lastUserIndex === -1) return messages;

        const content = this.getContentFromPool(action.pool);
        if (content) {
            messages[lastUserIndex].content = content + ' ' + messages[lastUserIndex].content;
        }

        return messages;
    }

    /**
     * Replace the last user message
     * @param {Object} action - Action configuration
     * @param {Array} messages - Array of messages
     * @returns {Array} Modified messages array
     */
    replaceLastUser(action, messages) {
        const lastUserIndex = this.findLastUserMessageIndex(messages);
        if (lastUserIndex === -1) return messages;

        const content = this.getContentFromPool(action.pool);
        if (content) {
            messages[lastUserIndex].content = content;
        }

        return messages;
    }

    /**
     * Add a new message to the conversation
     * @param {Object} action - Action configuration
     * @param {Array} messages - Array of messages
     * @returns {Array} Modified messages array
     */
    addNewMessage(action, messages) {
        const content = this.getContentFromPool(action.pool);
        if (content) {
            messages.push({
                role: action.role || 'user',
                content: content
            });
        }

        return messages;
    }

    /**
     * Execute a template action
     * @param {Object} action - Action configuration
     * @param {Array} messages - Array of messages
     * @param {Object} plugin - Full plugin configuration
     * @returns {Array} Modified messages array
     */
    executeTemplate(action, messages, plugin) {
        if (!plugin.templates || !action.templateId) return messages;

        const template = plugin.templates.find(t => t.id === action.templateId);
        if (!template) return messages;

        const processedContent = this.processTemplate(template.content, messages);

        // Execute the template as if it were content in a pool
        const templateAction = {
            ...action,
            pool: [processedContent]
        };

        return this.executeAction(templateAction, messages, plugin);
    }

    /**
     * Process template content with variable substitution
     * @param {string} content - Template content
     * @param {Array} messages - Array of messages for context
     * @returns {string} Processed content
     */
    processTemplate(content, messages) {
        let processed = content;

        // Replace {{lastMessage}} with the content of the last message
        if (messages.length > 0) {
            processed = processed.replace(/\{\{lastMessage\}\}/g, messages[messages.length - 1].content || '');
        }

        // Replace {{messageCount}} with the current message count
        processed = processed.replace(/\{\{messageCount\}\}/g, this.messageCount.toString());

        // Replace custom variables
        for (const [key, value] of Object.entries(this.variables)) {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            processed = processed.replace(regex, value.toString());
        }

        return processed;
    }

    /**
     * Get content from a pool (random selection)
     * @param {Array} pool - Array of content options
     * @returns {string|null} Selected content or null if pool is empty
     */
    getContentFromPool(pool) {
        if (!Array.isArray(pool) || pool.length === 0) {
            return null;
        }

        const randomIndex = Math.floor(Math.random() * pool.length);
        return pool[randomIndex];
    }

    /**
     * Find the index of the last user message
     * @param {Array} messages - Array of messages
     * @returns {number} Index of last user message or -1 if not found
     */
    findLastUserMessageIndex(messages) {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                return i;
            }
        }
        return -1;
    }

    /**
     * Find the index of the last assistant message
     * @param {Array} messages - Array of messages
     * @returns {number} Index of last assistant message or -1 if not found
     */
    findLastAssistantMessageIndex(messages) {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') {
                return i;
            }
        }
        return -1;
    }

    /**
     * Reset parser state
     */
    reset() {
        this.messageCount = 0;
        this.variables = {};
        this.stageHistory.clear();
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PluginParser;
}

// Example usage:
/*
const parser = new PluginParser();
const plugin = {
    // ... your plugin configuration
};
const messages = [
    { role: 'user', content: 'Hello world' },
    { role: 'assistant', content: 'Hi there!' }
];

const modifiedMessages = parser.parsePlugin(plugin, messages);
console.log(modifiedMessages);
*/