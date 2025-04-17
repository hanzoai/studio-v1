/**
 * Limits the length of a string, adding an ellipsis if truncated.
 *
 * @param {string | null | undefined} content - The string content to limit.
 * @param {number} [maxLength=8000] - The maximum allowed length.
 * @returns {string} - The original string or the truncated string with ellipsis.
 */
function limitContentLength(content, maxLength = 8000) {
  // Return empty string if content is null, undefined, or already empty
  if (!content) {
    return '';
  }

  // Ensure content is a string before checking length
  const stringContent = String(content);

  if (stringContent.length <= maxLength) {
    return stringContent;
  }

  // Truncate and add indicator
  // Ensure maxLength is at least 3 to accommodate ellipsis
  const effectiveMaxLength = Math.max(maxLength, 3);
  return stringContent.substring(0, effectiveMaxLength - 3) + '...';
}

module.exports = {
    limitContentLength
}; 