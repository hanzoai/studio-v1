#!/bin/bash

# Preserve existing PATH and add common paths
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Get the docker path
DOCKER_PATH="/usr/local/bin/docker" # Common install path, adjust if needed
if [ ! -f "$DOCKER_PATH" ]; then
  DOCKER_PATH=$(which docker 2>/dev/null)
  if [ -z "$DOCKER_PATH" ]; then
    echo "Error: docker executable not found in PATH"
    exit 1
  fi
fi

# Log environment for debugging
echo "Running docker with PATH: $PATH"
echo "Docker path: $DOCKER_PATH"

# Execute docker directly with all arguments
exec "$DOCKER_PATH" "$@" 