const MODEL_CONTEXT_SIZES = {
  default: {
    context: 8192,
    vision_supported: false,
  },
  "meta-llama/llama-4-scout-17b-16e-instruct": {
    context: 131072,
    vision_supported: true,
  },
  "meta-llama/llama-4-maverick-17b-128e-instruct": {
    context: 131072,
    vision_supported: true,
  },
  "gemma2-9b-it": {
    context: 8192,
    vision_supported: false,
  },
  "llama-3.3-70b-versatile": {
    context: 128000,
    vision_supported: false,
  },
  "llama3-70b-8192": {
    context: 8192,
    vision_supported: false,
  },
  "llama3-8b-8192": {
    context: 8192,
    vision_supported: false,
  },
  "llama-3.1-8b-instant": {
    context: 128000,
    vision_supported: false,
  },
  "qwen-qwq-32b": {
    context: 128000,
    vision_supported: true,
  },
  "deepseek-r1-distill-llama-70b": {
    context: 128000,
    vision_supported: false,
  }
};

module.exports = { MODEL_CONTEXT_SIZES };
