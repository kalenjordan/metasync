/**
 * Logging Utilities
 *
 * Provides consistent log formatting for Shopify operations with:
 * - Indentation
 * - Symbols for operations and statuses
 * - Color coding
 */
const consola = require('consola');

class LoggingUtils {
  /**
   * Create a formatted log for a main product action
   * @param {string} message - Log message
   * @param {string} title - Product title
   * @param {string} handle - Product handle
   * @param {string} type - Type of action (update, create, delete, etc.)
   * @param {number} level - Indentation level (0, 1, 2, etc.)
   */
  static logProductAction(message, title, handle, type = 'update', level = 0) {
    let color = '36'; // Default cyan for update

    if (type === 'create') {
      color = '32'; // Green
    } else if (type === 'delete' || type === 'force-recreate') {
      color = '33'; // Yellow/amber
    } else if (type === 'error') {
      color = '31'; // Red
    }

    const indent = '  '.repeat(level);
    consola.log(`${indent}\u001b[1m\u001b[${color}m◆ ${message}: ${title} (${handle})\u001b[0m`);
  }

  /**
   * Format a success message with proper indentation and symbol
   * @param {string} message - Log message
   * @param {string} level - Indentation level (0, 1, 2, etc.)
   */
  static success(message, level = 0) {
    const indent = '  '.repeat(level);
    consola.log(`${indent}\u001b[32m✓ ${message}\u001b[0m`);
  }

  /**
   * Format an error message with proper indentation and symbol
   * @param {string} message - Log message
   * @param {string} level - Indentation level (0, 1, 2, etc.)
   * @param {Object} data - Additional error data to log
   */
  static error(message, level = 0, data = null) {
    const indent = '  '.repeat(level);
    if (data) {
      consola.log(`${indent}\u001b[31m✖ ${message}\u001b[0m`, data);
    } else {
      consola.log(`${indent}\u001b[31m✖ ${message}\u001b[0m`);
    }
  }

  /**
   * Format a warning message with proper indentation and symbol
   * @param {string} message - Log message
   * @param {string} level - Indentation level (0, 1, 2, etc.)
   */
  static warn(message, level = 0) {
    const indent = '  '.repeat(level);
    consola.log(`${indent}\u001b[33m⚠ ${message}\u001b[0m`);
  }

  /**
   * Format an info message with proper indentation and symbol
   * @param {string} message - Log message
   * @param {string} level - Indentation level (0, 1, 2, etc.)
   * @param {string} type - Type of info (main, sub, detail)
   */
  static info(message, level = 0, type = 'detail') {
    const indent = '  '.repeat(level);
    let symbol = '-'; // Default for detail

    if (type === 'main') {
      symbol = '•'; // Main operation
    } else if (type === 'sub') {
      symbol = '◦'; // Sub-operation
    }

    consola.log(`${indent}${symbol} ${message}`);
  }

  /**
   * Format a dry run message with proper indentation
   * @param {string} message - Log message
   * @param {string} level - Indentation level (0, 1, 2, etc.)
   */
  static dryRun(message, level = 0) {
    const indent = '  '.repeat(level);
    consola.log(`${indent}[DRY RUN] ${message}`);
  }
}

module.exports = LoggingUtils;
