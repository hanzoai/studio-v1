const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
// Import MCP client
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
// Import shared models
const { MODEL_CONTEXT_SIZES } = require('../shared/models.js');
// Import handlers and utils
const chatHandler = require('./chatHandler');
const toolHandler = require('./toolHandler');

let mainWindow;
// Store MCP client instances
let mcpClients = {};
// Store discovered tools
let discoveredTools = [];
// Variable to hold loaded model context sizes
let modelContextSizes = {};

// Determine if the app is packaged
const isPackaged = app.isPackaged;

// Helper function to get the correct base path for scripts
function getScriptsBasePath() {
  return isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'scripts')
    : path.join(__dirname, 'scripts'); // Development path
}


function createWindow() {
  const { height, width } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1400, width),
    height: height,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // In production, use the built app
  // In development, use the dev server
  const startUrl = process.env.NODE_ENV === 'development'
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../dist/index.html')}`;

  mainWindow.loadURL(startUrl);

  // Open DevTools during development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Handle external links to open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Check if the URL is external (not our app)
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Handle clicked links in the app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Check if the URL is external (not our app)
    if (url.startsWith('http:') || url.startsWith('https:') &&
        url !== startUrl && !url.startsWith('http://localhost:5173')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

app.whenReady().then(async () => {
  // Load model context sizes from the JS module
  try {
    // The require statement at the top already loaded it. Assign it here.
    modelContextSizes = MODEL_CONTEXT_SIZES;
    console.log('Successfully loaded shared model definitions from models.js.');
  } catch (error) {
    console.error('Failed to load shared model definitions from models.js:', error);
    // Use a minimal fallback if loading fails
    modelContextSizes = { 'default': { context: 8192, vision_supported: false } };
  }

  createWindow();

  // Log settings path for debugging
  const userDataPath = app.getPath('userData');
  const settingsPath = path.join(userDataPath, 'settings.json');
  console.log('Settings file location:', settingsPath);


  connectConfiguredMcpServers();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Helper function to load settings with defaults and validation
function loadSettings() {
    const userDataPath = app.getPath('userData');
    const settingsPath = path.join(userDataPath, 'settings.json');
    const defaultSettings = {
        HANZO_API_KEY: "<replace me>",
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        temperature: 0.7,
        top_p: 0.95,
        mcpServers: {},
        disabledMcpServers: [],
        customSystemPrompt: ''
    };

    try {
        if (fs.existsSync(settingsPath)) {
            const data = fs.readFileSync(settingsPath, 'utf8');
            const loadedSettings = JSON.parse(data);

            // Merge defaults and ensure required fields exist, applying defaults if necessary
            const settings = { ...defaultSettings, ...loadedSettings };

            // Explicitly check and apply defaults for potentially missing/undefined fields
            settings.HANZO_API_KEY = settings.HANZO_API_KEY || defaultSettings.HANZO_API_KEY;
            settings.model = settings.model || defaultSettings.model;
            settings.temperature = settings.temperature ?? defaultSettings.temperature; // Use nullish coalescing
            settings.top_p = settings.top_p ?? defaultSettings.top_p;
            settings.mcpServers = settings.mcpServers || defaultSettings.mcpServers;
            settings.disabledMcpServers = settings.disabledMcpServers || defaultSettings.disabledMcpServers;
            settings.customSystemPrompt = settings.customSystemPrompt || defaultSettings.customSystemPrompt;

            // Optional: Persist the potentially updated settings back to file if defaults were applied
            // fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

            return settings;
        } else {
            // Create settings file with defaults if it doesn't exist
            fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
            return defaultSettings;
        }
    } catch (error) {
        console.error('Error reading or parsing settings:', error);
        // Return defaults in case of error
        return defaultSettings;
    }
}

// Handler for getting settings
ipcMain.handle('get-settings', async () => {
  return loadSettings(); // Use the helper function
});

// Handler for getting settings file path
ipcMain.handle('get-settings-path', async () => {
  const userDataPath = app.getPath('userData');
  const settingsPath = path.join(userDataPath, 'settings.json');
  return settingsPath;
});

// Handler for reloading settings from disk
ipcMain.handle('reload-settings', async () => {
  try {
    const settings = loadSettings(); // Use helper to reload and validate
    return { success: true, settings };
  } catch (error) {
     // loadSettings handles internal errors, but catch any unexpected ones here
     console.error('Error reloading settings via handler:', error);
     return { success: false, error: error.message };
  }
});

// Handler for saving settings
ipcMain.handle('save-settings', async (event, settings) => {
  const userDataPath = app.getPath('userData');
  const settingsPath = path.join(userDataPath, 'settings.json');

  try {
    // Basic validation before saving
    if (!settings || typeof settings !== 'object') {
        throw new Error("Invalid settings object provided.");
    }
     // Optionally add more validation here (e.g., check types of fields)
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return { success: true };
  } catch (error) {
    console.error('Error saving settings:', error);
    return { success: false, error: error.message };
  }
});

// Add sleep utility function
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Chat completion with streaming - uses chatHandler
ipcMain.on('chat-stream', async (event, messages, model) => {
  // Load settings *here* to pass the current state to the handler
  const currentSettings = loadSettings();

  // Delegate to the handler, passing necessary context
  // Ensure modelContextSizes and discoveredTools are accessible in this scope
  chatHandler.handleChatStream(event, messages, model, currentSettings, modelContextSizes, discoveredTools);
});

// Handler for executing tool calls - uses toolHandler
ipcMain.handle('execute-tool-call', async (event, toolCall) => {
  // Delegate to the handler, passing necessary context
  // Ensure discoveredTools and mcpClients are accessible in this scope
  return toolHandler.handleExecuteToolCall(event, toolCall, discoveredTools, mcpClients);
});

// Helper function to check if a path exists
function checkPathExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (e) {
    // Ignore errors like permission denied
    return false;
  }
}

// Helper function to find a command using 'which'
function findCommandUsingWhich(command) {
  try {
    // Escape command to prevent injection issues if needed, though 'which' is generally safe
    const safeCommand = command.replace(/[^a-zA-Z0-9_\-\.]/g, ''); // Basic sanitization
    if (safeCommand !== command) {
        console.warn(`Command '${command}' sanitized to '${safeCommand}' for 'which' lookup.`);
    }
    if (!safeCommand) return null; // Don't run 'which' with empty string

    const { execSync } = require('child_process');
    const commandPath = execSync(`which ${safeCommand}`).toString().trim();
    if (commandPath && checkPathExists(commandPath)) {
      console.log(`Found ${command} using 'which' at ${commandPath}`);
      return commandPath;
    }
  } catch (error) {
    // Silently fail if 'which' command fails or path doesn't exist
    // console.error(`'which ${command}' failed:`, error.message); // Optional debug log
  }
  return null;
}

// Refactored function to resolve command paths
function resolveCommandPath(command) {
  // If not a simple command name, return as is (likely already a path)
  if (!command || typeof command !== 'string' || command.includes('/') || command.includes('\\')) {
    return command;
  }

  const scriptBasePath = getScriptsBasePath(); // Use helper

  // Define configurations for commands that might need special handling or scripts
  const specialCommands = {
    'npx': {
      scriptName: 'run-npx.sh', // Example script name
      knownPaths: [
        '/usr/local/bin/npx',
        '/usr/bin/npx',
        // Common NVM paths (adjust based on typical user setups)
        `${process.env.HOME}/.nvm/versions/node/v18/bin/npx`, // Example common versions
        `${process.env.HOME}/.nvm/versions/node/v20/bin/npx`,
        `${process.env.HOME}/.nvm/versions/node/v22/bin/npx`,
        `${process.env.HOME}/.nvm/current/bin/npx`, // NVM 'current' alias
      ]
    },
    'uvx': {
      scriptName: 'run-uvx.sh', // Example script name
      knownPaths: [
        '/opt/homebrew/bin/uvx', // Common Homebrew path (Apple Silicon)
        '/usr/local/bin/uvx',    // Common Homebrew/manual install path
        '/usr/bin/uvx',          // Less common system path
         `${process.env.HOME}/.local/bin/uvx` // User-specific install
      ]
    },
    // Commands that might benefit from a wrapper script but don't have common known paths listed here
    'docker': { scriptName: 'run-docker.sh' },
    'node': { scriptName: 'run-node.sh' }
    // Add other commands as needed
  };

  // 1. Check if the command has special handling defined
  if (specialCommands[command]) {
    const config = specialCommands[command];
    const scriptPath = path.join(scriptBasePath, config.scriptName);

    // 1a. Prioritize using the custom script if it exists
    if (checkPathExists(scriptPath)) {
      console.log(`Using custom script for ${command}: ${scriptPath}`);
      return scriptPath;
    }

    // 1b. If script doesn't exist, check known common paths (if defined)
    if (config.knownPaths) {
      for (const knownPath of config.knownPaths) {
         // Expand ~ if present (though process.env.HOME is preferred)
         const expandedPath = knownPath.startsWith('~')
             ? path.join(process.env.HOME || '', knownPath.substring(1))
             : knownPath;
        if (checkPathExists(expandedPath)) {
          console.log(`Found ${command} at known path: ${expandedPath}`);
          return expandedPath;
        }
      }
    }
  }

  // 2. If no special handling resolved it, try using 'which'
  const whichPath = findCommandUsingWhich(command);
  if (whichPath) {
    // Logging is handled within findCommandUsingWhich
    return whichPath;
  }

  // 3. Final fallback: If 'which' fails, return the original command name.
  //    This relies on the command being in the system's PATH when executed.
  console.log(`Could not resolve path for '${command}' via script, known paths, or 'which'. Assuming it's in PATH.`);
  return command;
}

// Handler for connecting to an MCP server
ipcMain.handle('connect-mcp-server', async (event, serverConfig) => {
    // Validate serverConfig structure
    if (!serverConfig || !serverConfig.id || (!serverConfig.scriptPath && !serverConfig.command)) {
        console.error("Invalid serverConfig received for connect-mcp-server:", serverConfig);
        return {
            success: false,
            error: "Invalid server configuration provided. Requires id and either scriptPath or command.",
            tools: [],
            allTools: discoveredTools
        };
    }

  try {
    const { id, scriptPath, command, args, env } = serverConfig;

    // Ensure server ID is removed from the disabled list in settings
    const settings = loadSettings();
    let settingsUpdated = false;
    if (settings.disabledMcpServers && settings.disabledMcpServers.includes(id)) {
        settings.disabledMcpServers = settings.disabledMcpServers.filter(serverId => serverId !== id);
        // Save updated settings
        const userDataPath = app.getPath('userData');
        const settingsPath = path.join(userDataPath, 'settings.json');
        try {
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            console.log(`Removed server ${id} from disabled list in settings.`);
            settingsUpdated = true;
        } catch (saveError) {
             console.error(`Failed to save settings after removing ${id} from disabled list:`, saveError);
             // Proceed with connection attempt anyway, but log the failure
        }
    }


    let connectionDetails;
    if (command) {
        // Use command/args directly
        const resolvedCommand = resolveCommandPath(command); // Resolve command path
        connectionDetails = {
            command: resolvedCommand,
            args: args || [],
            env: env || {}
        };
    } else if (scriptPath) {
        // Use scriptPath
        const absoluteScriptPath = path.resolve(scriptPath); // Ensure absolute path
        if (!fs.existsSync(absoluteScriptPath)) {
            return {
                success: false,
                error: `Server script not found: ${absoluteScriptPath}`,
                tools: [],
                allTools: discoveredTools
            };
        }

        // Determine script type and appropriate command
        const isJs = absoluteScriptPath.endsWith('.js');
        const isPy = absoluteScriptPath.endsWith('.py');

        if (!isJs && !isPy) {
            return {
                success: false,
                error: "Server script must be a .js or .py file",
                tools: [],
                allTools: discoveredTools
            };
        }

        // Use 'node' (process.execPath) for .js, 'python3' (or 'python') for .py
        const scriptCommand = isPy
            ? (process.platform === "win32" ? "python" : "python3") // Consider python executable configuration?
            : process.execPath; // Use the current Node executable path

        connectionDetails = {
            command: scriptCommand,
            args: [absoluteScriptPath, ...(args || [])], // Include script path and any extra args
            env: env || {}
        };
    } else {
         // This case should be caught by initial validation, but belt-and-suspenders
         return { success: false, error: "Internal Error: No command or scriptPath provided.", tools: [], allTools: discoveredTools };
    }

    // Attempt connection using the determined details
    const result = await connectMcpServerProcess(id, connectionDetails);
    return {
      success: true,
      tools: result.tools || [], // Ensure tools array exists
      allTools: discoveredTools // Return the current full list
    };

  } catch (error) {
    console.error(`Error connecting to MCP server (${serverConfig?.id || 'unknown ID'}):`, error);
    // Return current state even on failure
    return {
      success: false,
      error: error.message || "An unknown error occurred during connection.",
      tools: [], // No new tools discovered on failure
      allTools: discoveredTools
    };
  }
});

// Handler for disconnecting from an MCP server
ipcMain.handle('disconnect-mcp-server', async (event, serverId) => {
  // Validate serverId
  if (!serverId || typeof serverId !== 'string') {
       console.error("Invalid serverId received for disconnect-mcp-server:", serverId);
       return { success: false, error: "Invalid Server ID provided.", allTools: discoveredTools };
  }

  try {
    // Add server to disabled list in settings
    const settings = loadSettings();
    let settingsUpdated = false;
    // Initialize the disabled list if it doesn't exist
    if (!settings.disabledMcpServers) {
        settings.disabledMcpServers = [];
    }
    // Add server ID if not already present
    if (!settings.disabledMcpServers.includes(serverId)) {
        settings.disabledMcpServers.push(serverId);
        settingsUpdated = true;
    }

    if (settingsUpdated) {
        const userDataPath = app.getPath('userData');
        const settingsPath = path.join(userDataPath, 'settings.json');
        try {
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            console.log(`Added server ${serverId} to disabled list in settings.`);
        } catch (saveError) {
            console.error(`Failed to save settings after adding ${serverId} to disabled list:`, saveError);
            // Continue with disconnect anyway
        }
    }

    // Disconnect the client if it exists
    if (mcpClients[serverId]) {
      const client = mcpClients[serverId];
      // Clear the health check interval before closing
      if (client.healthCheckInterval) {
        clearInterval(client.healthCheckInterval);
        console.log(`Cleared health check interval for server ${serverId}`);
      }

      try {
          await client.close();
          console.log(`Successfully closed connection to MCP server: ${serverId}`);
      } catch(closeError) {
         console.error(`Error during client.close() for server ${serverId}:`, closeError);
         // Continue cleanup even if close fails
      }

      delete mcpClients[serverId];

      // Remove tools associated with this server
      const initialToolCount = discoveredTools.length;
      discoveredTools = discoveredTools.filter(t => t.serverId !== serverId);
      const removedToolCount = initialToolCount - discoveredTools.length;
      console.log(`Removed ${removedToolCount} tools associated with server ${serverId}`);

      // Notify the renderer process about the change
      notifyMcpServerStatus();

      return { success: true, allTools: discoveredTools };
    } else {
        console.log(`No active client found for server ${serverId} to disconnect.`);
        // Still ensure tools are potentially cleaned up if client was lost unexpectedly
         discoveredTools = discoveredTools.filter(t => t.serverId !== serverId);
         notifyMcpServerStatus(); // Notify UI in case state was inconsistent
         return { success: true, message: "No active client found to disconnect.", allTools: discoveredTools };
    }

  } catch (error) {
    console.error(`Error disconnecting from MCP server ${serverId}:`, error);
    // Return current state even on failure
    return { success: false, error: error.message || "An unknown error occurred during disconnection.", allTools: discoveredTools };
  }
});

// Handler for getting all discovered tools
ipcMain.handle('get-mcp-tools', async () => {
  // Return a copy to prevent accidental modification
  return { tools: [...discoveredTools] };
});

// Function to connect to all configured MCP servers from settings
async function connectConfiguredMcpServers() {
  try {
    const settings = loadSettings(); // Use helper to get current, validated settings

    if (!settings.mcpServers || Object.keys(settings.mcpServers).length === 0) {
      console.log('No MCP servers configured in settings, skipping auto-connections.');
      return;
    }

    const disabledServers = settings.disabledMcpServers || [];
    const serverConfigs = Object.entries(settings.mcpServers);
    const enabledServerConfigs = serverConfigs.filter(([serverId]) => !disabledServers.includes(serverId));

    const totalCount = serverConfigs.length;
    const disabledCount = disabledServers.length;
    const enabledCount = enabledServerConfigs.length;

    console.log(`Found ${totalCount} configured MCP servers. Connecting to ${enabledCount} enabled servers (${disabledCount} disabled)...`);

    if (enabledCount === 0) return; // Nothing to connect

    // Track connection outcomes
    let successCount = 0;
    let failCount = 0;

    // Use Promise.allSettled to attempt connections concurrently and gather results
    const connectionPromises = enabledServerConfigs.map(async ([serverId, serverConfig]) => {
        try {
            console.log(`Attempting to connect to MCP server: ${serverId}`);
             // Validate config before attempting connection
            if (!serverConfig || !serverConfig.command) {
                throw new Error(`Invalid configuration for server ${serverId}: Missing 'command'.`);
            }

            const connectionDetails = {
                command: resolveCommandPath(serverConfig.command), // Resolve path here
                args: serverConfig.args || [],
                env: serverConfig.env || {}
            };
            await connectMcpServerProcess(serverId, connectionDetails);
            console.log(`Successfully connected to MCP server: ${serverId}`);
            return { status: 'fulfilled', serverId };
        } catch (error) {
            console.error(`Failed to connect to MCP server ${serverId}:`, error.message || error);
            // Don't re-throw, let allSettled capture the reason
            return { status: 'rejected', serverId, reason: error.message || error };
        }
    });

    const results = await Promise.allSettled(connectionPromises);

    // Process results
    results.forEach(result => {
        if (result.status === 'fulfilled') {
            successCount++;
        } else {
            failCount++;
            // Logging already done in the catch block above
        }
    });

    console.log(`MCP auto-connection summary: ${successCount} succeeded, ${failCount} failed.`);

  } catch (error) {
    // Catch errors related to loading settings or processing results
    console.error('Error during connectConfiguredMcpServers:', error);
  }
}

// Notify renderer process about MCP server status changes
function notifyMcpServerStatus() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send('mcp-server-status-changed', {
      tools: [...discoveredTools], // Send a copy
      connectedServers: Object.keys(mcpClients)
    });
     console.log('Notified renderer of MCP status change.');
  } else {
      console.warn('Cannot notify renderer: mainWindow not available or destroyed.');
  }
}

// Function to connect to an MCP server using process configuration
async function connectMcpServerProcess(serverId, serverConfig) {
    // --- Pre-connection Cleanup ---
    if (mcpClients[serverId]) {
        console.log(`Cleaning up existing client/connection for server ${serverId} before attempting new connection.`);
        const oldClient = mcpClients[serverId];
        // Clear any existing health check
        if (oldClient.healthCheckInterval) {
            clearInterval(oldClient.healthCheckInterval);
        }
        try {
            await oldClient.close();
        } catch (closeError) {
            console.warn(`Error closing previous client for ${serverId}: ${closeError.message}`);
        }
        delete mcpClients[serverId];
        // Remove potentially stale tools immediately
        discoveredTools = discoveredTools.filter(t => t.serverId !== serverId);
        // Notify UI about the cleanup phase starting
        notifyMcpServerStatus();
    }

    // --- Validate Config ---
    if (!serverConfig || !serverConfig.command) {
        throw new Error(`Missing command for MCP server ${serverId}`);
    }

    // --- Determine Server Type & Timeouts ---
    // Check if the *resolved* command path points to uvx
    const resolvedCommandBase = path.basename(serverConfig.command);
    const isUvx = resolvedCommandBase === 'uvx';
    const isPython = resolvedCommandBase === 'python' || resolvedCommandBase === 'python3';
    const connectTimeout = isUvx ? 10000 : (isPython ? 5000 : 3000); // Generous timeouts: uvx(10s), python(5s), other(3s)
    const listToolsTimeout = 15000; // Timeout specifically for the listTools call (15s)
    const healthCheckIntervalMs = 60000; // 60 seconds

    console.log(`Attempting connection to ${serverId} using command: ${serverConfig.command} (Timeout: ${connectTimeout}ms)`);
    // Log environment variables being passed if needed for debugging (be careful with sensitive data)
    // console.log(`Environment for ${serverId}:`, serverConfig.env);

    // --- Create Client and Transport ---
    const client = new Client({
        name: "hanzo-studio",
        version: app.getVersion(), // Use app version
        capabilities: { tools: true, prompts: true, resources: true } // Declare capabilities
    });

    const transportOptions = {
        command: serverConfig.command,
        args: serverConfig.args || [],
        env: { ...process.env, ...serverConfig.env }, // Merge environments
        connectTimeout: connectTimeout
    };
    const transport = new StdioClientTransport(transportOptions);

    // --- Connection and Initialization Logic ---
    try {
        console.log(`[${serverId}] Connecting transport...`);
        await client.connect(transport);
        mcpClients[serverId] = client; // Store client immediately after successful transport connection
        console.log(`[${serverId}] Transport connected. Listing tools...`);

        // --- List Tools with Timeout ---
        let toolsResult = null;
        try {
            // Use Promise.race for timeout on listTools
            toolsResult = await Promise.race([
                client.listTools(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`listTools timed out after ${listToolsTimeout}ms`)), listToolsTimeout)
                )
            ]);
        } catch (listToolsError) {
             console.error(`[${serverId}] Error during initial listTools:`, listToolsError);
            throw listToolsError; // Re-throw to be caught by the outer catch block for cleanup
        }


        // --- Process Tools ---
        if (!toolsResult || !toolsResult.tools || !Array.isArray(toolsResult.tools)) {
            console.warn(`[${serverId}] listTools succeeded but returned no tools or invalid format.`);
            // Consider this a successful connection, but with no tools
            serverTools = [];
        } else {
             serverTools = toolsResult.tools.map(tool => ({
                // Validate tool structure slightly
                name: tool.name || 'unnamed_tool',
                description: tool.description || 'No description',
                input_schema: tool.inputSchema || {}, // Ensure schema exists
                serverId: serverId // **Crucial: Associate tool with its server**
            }));
            console.log(`[${serverId}] Discovered ${serverTools.length} tools.`);
        }


        // --- Update Global State and Notify ---
        // Add newly discovered tools (already filtered old ones during cleanup)
        discoveredTools = [...discoveredTools, ...serverTools];
        // Set up health check *after* successful initialization
        setupServerHealthCheck(client, serverId, healthCheckIntervalMs);
        // Notify renderer about the successful connection and new tools
        notifyMcpServerStatus();

        return {
            success: true,
            tools: serverTools // Return only the tools discovered in this connection attempt
        };

    } catch (error) {
        console.error(`[${serverId}] Failed to connect or initialize:`, error.message || error);

        // --- Error Handling and Cleanup ---
        if (mcpClients[serverId]) {
            try {
                // Ensure health check is cleared on failure too
                if (mcpClients[serverId].healthCheckInterval) {
                    clearInterval(mcpClients[serverId].healthCheckInterval);
                }
                await mcpClients[serverId].close();
            } catch (closeError) {
                console.error(`[${serverId}] Error closing client after connection failure: ${closeError.message}`);
            }
            delete mcpClients[serverId]; // Remove failed client from active list
        }
        // Ensure tools are filtered again in case of partial failure state
        discoveredTools = discoveredTools.filter(t => t.serverId !== serverId);
        // Notify renderer about the failure (client removed, tools removed)
        notifyMcpServerStatus();

        // Re-throw the original error to be handled by the caller (e.g., connect-mcp-server handler)
        throw error;
    }
}

// Function to set up periodic health check for a server
function setupServerHealthCheck(client, serverId, intervalMs) {
  // Clear existing interval for this client if any (safety measure)
  if (client.healthCheckInterval) {
    clearInterval(client.healthCheckInterval);
    console.log(`[${serverId}] Cleared previous health check interval.`);
  }

  console.log(`[${serverId}] Setting up health check interval: ${intervalMs}ms`);

  client.healthCheckInterval = setInterval(async () => {
    console.log(`[${serverId}] Performing health check...`);
    try {
      // Use a lightweight operation like listTools for health check
      // Add a timeout specific to the health check itself
       const healthCheckTimeout = 15000; // 15s timeout for health check probe
       await Promise.race([
            client.listTools(), // Or potentially a dedicated health check endpoint if MCP SDK adds one
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Health check timed out after ${healthCheckTimeout}ms`)), healthCheckTimeout)
            )
        ]);
      // If listTools succeeds, server is considered healthy
      console.log(`[${serverId}] Health check successful.`);
    } catch (error) {
      console.error(`[${serverId}] Health check failed:`, error.message || error);

      // --- Recovery / Disconnect Logic ---
      clearInterval(client.healthCheckInterval); // Stop trying on this interval
      client.healthCheckInterval = null; // Clear the stored interval ID

      console.warn(`[${serverId}] Health check failed. Marking as disconnected and cleaning up.`);

      // Clean up the failed client connection
       if (mcpClients[serverId] === client) { // Ensure we're removing the correct client instance
           delete mcpClients[serverId];
           // Remove tools associated with this server
           discoveredTools = discoveredTools.filter(t => t.serverId !== serverId);
           // Notify renderer about the disconnection due to health check failure
           notifyMcpServerStatus();

           // Attempt to close the client connection gracefully, but don't wait indefinitely
           try {
               await client.close();
               console.log(`[${serverId}] Closed client connection after health check failure.`);
           } catch (closeError) {
               console.error(`[${serverId}] Error closing client after health check failure: ${closeError.message}`);
           }
       } else {
           console.warn(`[${serverId}] Client instance mismatch during health check failure cleanup. State might be inconsistent.`);
       }

       // Optional: Attempt automatic reconnection after a delay? (Could lead to loops)
       // For now, require manual reconnection via UI or restart.
    }
  }, intervalMs); // Use the provided interval

   // Handle process exit for the client's underlying process
    if (client.transport?.process) {
        client.transport.process.on('exit', (code, signal) => {
            console.warn(`[${serverId}] Underlying process exited unexpectedly with code ${code}, signal ${signal}.`);
             // Trigger cleanup similar to health check failure
            if (client.healthCheckInterval) {
                clearInterval(client.healthCheckInterval);
                client.healthCheckInterval = null;
            }
            if (mcpClients[serverId] === client) {
                delete mcpClients[serverId];
                discoveredTools = discoveredTools.filter(t => t.serverId !== serverId);
                notifyMcpServerStatus();
                console.log(`[${serverId}] Cleaned up client and tools due to unexpected process exit.`);
            }
        });
         client.transport.process.on('error', (err) => {
            console.error(`[${serverId}] Error from underlying process:`, err);
             // Consider triggering cleanup here as well if the error is fatal
        });
    }
}

// Handler for getting model configurations
ipcMain.handle('get-model-configs', async () => {
  // Return a copy to prevent accidental modification from renderer if needed
  return JSON.parse(JSON.stringify(modelContextSizes));
});
