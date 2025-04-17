const { ipcRenderer, contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getSettingsPath: () => ipcRenderer.invoke('get-settings-path'),
  reloadSettings: () => ipcRenderer.invoke('reload-settings'),
  // Chat API - streaming only
  executeToolCall: (toolCall) => ipcRenderer.invoke('execute-tool-call', toolCall),
  
  // Streaming API events
  startChatStream: (messages, model) => {
    // Start a new chat stream
    ipcRenderer.send('chat-stream', messages, model);
    
    // Setup event listeners for streaming responses
    return {
      onStart: (callback) => {
        ipcRenderer.on('chat-stream-start', (_, data) => callback(data));
        return () => ipcRenderer.removeListener('chat-stream-start', callback);
      },
      onContent: (callback) => {
        ipcRenderer.on('chat-stream-content', (_, data) => callback(data));
        return () => ipcRenderer.removeListener('chat-stream-content', callback);
      },
      onToolCalls: (callback) => {
        ipcRenderer.on('chat-stream-tool-calls', (_, data) => callback(data));
        return () => ipcRenderer.removeListener('chat-stream-tool-calls', callback);
      },
      onComplete: (callback) => {
        ipcRenderer.on('chat-stream-complete', (_, data) => callback(data));
        return () => ipcRenderer.removeListener('chat-stream-complete', callback);
      },
      onError: (callback) => {
        ipcRenderer.on('chat-stream-error', (_, data) => callback(data));
        return () => ipcRenderer.removeListener('chat-stream-error', callback);
      },
      cleanup: () => {
        ipcRenderer.removeAllListeners('chat-stream-start');
        ipcRenderer.removeAllListeners('chat-stream-content');
        ipcRenderer.removeAllListeners('chat-stream-tool-calls');
        ipcRenderer.removeAllListeners('chat-stream-complete');
        ipcRenderer.removeAllListeners('chat-stream-error');
      }
    };
  },
  
  // MCP related functions
  connectMcpServer: (serverConfig) => ipcRenderer.invoke('connect-mcp-server', serverConfig),
  disconnectMcpServer: (serverId) => ipcRenderer.invoke('disconnect-mcp-server', serverId),
  getMcpTools: () => ipcRenderer.invoke('get-mcp-tools'),
  // Function to get model configurations
  getModelConfigs: () => ipcRenderer.invoke('get-model-configs'),
  
  // Add event listener for MCP server status changes
  onMcpServerStatusChanged: (callback) => {
    // Remove any existing listeners to avoid duplicates
    ipcRenderer.removeAllListeners('mcp-server-status-changed');
    
    // Add the new listener
    ipcRenderer.on('mcp-server-status-changed', (event, data) => {
      callback(data);
    });
    
    // Return a function to remove the listener
    return () => {
      ipcRenderer.removeAllListeners('mcp-server-status-changed');
    };
  }
}); 