/**
 * Prunes message history to stay under 50% of model's context window
 * Always keeps the first two messages (if available) and the last message
 * Handles image filtering based on specified rules.
 * @param {Array} messages - Complete message history (should be cleaned format)
 * @param {String} model - Selected model name
 * @param {object} modelContextSizes - Object containing context window sizes for models.
 * @returns {Array} - Pruned message history array
 */
function pruneMessageHistory(messages, model, modelContextSizes) {
  // Handle edge cases: empty array, single message, or just two messages
  if (!messages || !Array.isArray(messages) || messages.length <= 2) {
    return messages ? [...messages] : [];
  }

  // Get context window size for the selected model, default if unknown
  const modelInfo = modelContextSizes[model] || modelContextSizes['default'] || { context: 8192 }; // Ensure default
  const contextWindow = modelInfo.context;
  const targetTokenCount = Math.floor(contextWindow * 0.5); // Use 50% of context window

  // Create a copy to avoid modifying the original array
  let prunedMessages = [...messages];

  // --- Image Pruning Logic --- (Assumes cleaned message format)
  let totalImageCount = 0;
  let lastUserMessageWithImagesIndex = -1;

  prunedMessages.forEach((msg, index) => {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const imageParts = msg.content.filter(part => part.type === 'image_url');
      if (imageParts.length > 0) {
        totalImageCount += imageParts.length;
        lastUserMessageWithImagesIndex = index; // Keep track of the latest one
      }
    }
  });

  // If total images exceed 5, keep only images from the last user message that had them
  if (totalImageCount > 5 && lastUserMessageWithImagesIndex !== -1) {
    console.log(`Total image count (${totalImageCount}) exceeds 5. Keeping images only from the last user message (index ${lastUserMessageWithImagesIndex}).`);
    prunedMessages = prunedMessages.map((msg, index) => {
      if (msg.role === 'user' && Array.isArray(msg.content) && index !== lastUserMessageWithImagesIndex) {
        // Filter out image_url parts from older user messages
        const textParts = msg.content.filter(part => part.type === 'text');

        // If only text parts remain, keep the message with only text parts
        if (textParts.length > 0) {
            // If there was only one text part originally, simplify back to string content? No, keep array structure.
            // console.log(`Removing images from message ${index}, keeping text parts.`);
             return { ...msg, content: textParts };
        } else {
            // If the message becomes empty after removing images, filter it out later?
            // For now, let's keep it but mark content as empty text array
            // console.log(`Message ${index} becomes empty after image removal.`);
            return { ...msg, content: [{ type: 'text', text: '' }] }; // Represent as empty text
        }
      }
      return msg;
    });
    // Optional: Filter out messages that became effectively empty?
    // prunedMessages = prunedMessages.filter(msg => !(msg.role === 'user' && Array.isArray(msg.content) && msg.content.length === 1 && msg.content[0].type === 'text' && msg.content[0].text === ''));
  }
  // --- End Image Pruning Logic ---

  // Recalculate tokens after potential image pruning
  let currentTotalTokens = prunedMessages.reduce((sum, msg) => sum + estimateTokenCount(msg), 0);

  // If we're already under the target, no text-based pruning needed
  if (currentTotalTokens <= targetTokenCount) {
    console.log(`Token count (${currentTotalTokens}) is within target (${targetTokenCount}) after image pruning. No text pruning needed.`);
    return prunedMessages;
  }

  console.log(`Token count (${currentTotalTokens}) exceeds target (${targetTokenCount}). Starting text pruning...`);

  // Keep track of text-based pruned messages
  let messagesPrunedCount = 0;

  // Start pruning from index 1 (second message, as index 0 is system/first user) and continue until we're under the target
  // Preserve index 0 (system/first user) and the last message
  while (prunedMessages.length > 2 && currentTotalTokens > targetTokenCount) {
    // Index 1 is the candidate for removal (oldest non-system/first message)
    const messageToRemove = prunedMessages[1];

    // Don't remove the very last message
    if (prunedMessages.length <= 2) break; // Should be caught by loop condition, but safety first

    const tokensForMessage = estimateTokenCount(messageToRemove);
    prunedMessages.splice(1, 1);
    currentTotalTokens -= tokensForMessage;
    messagesPrunedCount++;
    // console.log(`Pruned message at index 1 (was role ${messageToRemove.role}). New count: ${prunedMessages.length}, Tokens: ${currentTotalTokens}`);
  }

  if (messagesPrunedCount > 0) {
    console.log(`Pruned ${messagesPrunedCount} messages based on token count. Final tokens: ${currentTotalTokens} (target: ${targetTokenCount})`);
  }

  return prunedMessages;
}

/**
 * Estimates token count for a single message (ignoring image tokens).
 * @param {Object} message - Message object with role and content.
 * @returns {Number} - Estimated token count.
 */
function estimateTokenCount(message) {
  if (!message) return 0;

  let tokenCount = 0;
  let textContent = '';

  // Handle different content structures (string or array)
  if (typeof message.content === 'string') {
    textContent = message.content;
  } else if (Array.isArray(message.content)) {
    // Sum text content length from text parts
    textContent = message.content
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n'); // Join text parts for length calculation
  }
  // NOTE: Ignoring non-text/image parts if the array format is extended.

  // Basic approximation: characters / 4
  if (textContent) {
    // Add tokens based on character count (e.g., simple approximation)
    tokenCount += Math.ceil(textContent.length / 4);
  }

  // Account for tool calls in assistant messages
  if (message.role === 'assistant' && message.tool_calls && Array.isArray(message.tool_calls)) {
    message.tool_calls.forEach(toolCall => {
      // Estimate tokens for the JSON representation of the tool call
      try {
          const serializedToolCall = JSON.stringify(toolCall);
          tokenCount += Math.ceil(serializedToolCall.length / 4);
      } catch (e) {
          console.warn("Error serializing tool call for token estimation:", e);
          tokenCount += 50; // Add arbitrary penalty if serialization fails
      }
    });
  }

  // Account for tool results in tool messages
  if (message.role === 'tool') {
      // Estimate tokens for the (potentially stringified) content of the tool result
      const contentString = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
      tokenCount += Math.ceil(contentString.length / 4);
      // Add a small overhead for the tool role/id itself
      tokenCount += 10; // Rough estimate for tool_call_id, role etc.
  }

  // Add a small base token count per message for metadata (role, etc.)
  tokenCount += 5; // Arbitrary small number

  // NOTE: Image token cost is currently ignored in this estimation.
  // A more accurate approach would require model-specific tokenization or heuristics.

  return tokenCount;
}

module.exports = {
    pruneMessageHistory,
    estimateTokenCount
}; 