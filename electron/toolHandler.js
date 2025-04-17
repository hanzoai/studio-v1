const { limitContentLength } = require('./utils');

/**
 * Handles the 'execute-tool-call' IPC event.
 *
 * @param {Electron.IpcMainInvokeEvent} event - The IPC event object.
 * @param {object} toolCall - The tool call object received from the model.
 * @param {Array<object>} discoveredTools - List of available MCP tools.
 * @param {object} mcpClients - Object mapping server IDs to active MCP client instances.
 * @returns {Promise<object>} - A promise resolving to the tool result or error.
 */
async function handleExecuteToolCall(event, toolCall, discoveredTools, mcpClients) {
  console.log(`Handling execute-tool-call for: ${toolCall?.function?.name} (ID: ${toolCall?.id})`);

  // Basic validation of the tool call object
  if (!toolCall || !toolCall.id || !toolCall.function || !toolCall.function.name) {
     console.error('Invalid tool call object received:', toolCall);
     return { error: "Invalid tool call structure received from model.", tool_call_id: toolCall?.id || 'unknown' };
  }

  const toolName = toolCall.function.name;
  const toolCallId = toolCall.id;

  try {
    // Find the MCP tool configuration matching the requested tool name
    const mcpTool = discoveredTools.find(t => t.name === toolName);

    if (!mcpTool) {
      console.error(`Tool "${toolName}" not found among discovered tools.`);
      return {
        error: `Unknown tool: ${toolName}. It might be disconnected or not available.`,
        tool_call_id: toolCallId
      };
    }

    // Find the specific client instance that provides this tool using serverId
    const clientId = mcpTool.serverId;
    if (!clientId) {
        console.error(`Tool configuration for "${toolName}" is missing its serverId.`);
         return {
            error: `Internal configuration error: Tool "${toolName}" has no associated server ID.`,
            tool_call_id: toolCallId
        };
    }

    const client = mcpClients[clientId];
    if (!client) {
      console.error(`MCP Client instance not found for server ID: ${clientId} (required by tool ${toolName})`);
      return {
        error: `The server providing the tool "${toolName}" (ID: ${clientId}) is not currently connected or active.`,
        tool_call_id: toolCallId
      };
    }

    // Safely parse arguments
    let args;
    try {
      // Handle cases where arguments might be null, undefined, or an empty string
      if (toolCall.function.arguments === null || toolCall.function.arguments === undefined || toolCall.function.arguments.trim() === '') {
          args = {}; // Treat as empty object if no arguments provided
      } else {
          args = JSON.parse(toolCall.function.arguments);
      }
       // Optional: Validate parsed args against mcpTool.input_schema here
    } catch (parseError) {
      console.error(`Error parsing arguments for tool "${toolName}": ${parseError.message}`);
      console.error(`Raw arguments string:`, toolCall.function.arguments);
      return {
        error: `Failed to parse arguments for tool "${toolName}". Please ensure arguments are valid JSON. Error: ${parseError.message}`,
        tool_call_id: toolCallId
      };
    }

    // Execute the tool call via the MCP client
    console.log(`Executing MCP tool "${toolName}" on server ${clientId} with args:`, args);
    try {
      const result = await client.callTool({
        name: toolName,
        arguments: args
      });

       console.log(`MCP tool "${toolName}" executed successfully. Result content length: ${JSON.stringify(result?.content)?.length}`);

       // Prepare result, ensuring content is stringified and limited
       let resultString;
       try {
            // Handle different types of content (string, object, null, etc.)
            if (result?.content === undefined || result?.content === null) {
                resultString = ""; // Represent null/undefined content as empty string
            } else if (typeof result.content === 'string') {
                resultString = result.content;
            } else {
                resultString = JSON.stringify(result.content);
            }
       } catch (stringifyError) {
           console.error(`Failed to stringify result content for tool "${toolName}":`, stringifyError);
           resultString = `[Error stringifying tool result: ${stringifyError.message}]`;
       }

      return {
        result: limitContentLength(resultString), // Limit length *after* stringifying
        tool_call_id: toolCallId
      };
    } catch (executionError) {
      console.error(`Error executing MCP tool call for "${toolName}": ${executionError.message}`);
      // Log the execution error stack if available
      if (executionError.stack) {
           console.error(executionError.stack);
      }
      return {
        // Provide a more informative error message back to the model
        error: limitContentLength(`Error during execution of tool "${toolName}": ${executionError.message}`),
        tool_call_id: toolCallId
      };
    }

  } catch (handlerError) {
    // Catch unexpected errors within the handler logic itself
    console.error(`Unexpected error in handleExecuteToolCall for tool "${toolName}":`, handlerError);
    return {
      error: limitContentLength(`Internal error while handling tool call "${toolName}": ${handlerError.message}`),
      tool_call_id: toolCallId
    };
  }
}

module.exports = {
    handleExecuteToolCall
}; 