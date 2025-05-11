/**
 * Logging Utilities
 *
 * Provides consistent log formatting for Shopify operations with:
 * - Indentation
 * - Symbols for operations and statuses
 * - Color coding
 */
const consola = require('consola');
const chalk = require('chalk');

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
    let color = chalk.cyan; // Default cyan for update

    if (type === 'create') {
      color = chalk.green; // Green
    } else if (type === 'delete' || type === 'force-recreate') {
      color = chalk.yellow; // Yellow/amber
    } else if (type === 'error') {
      color = chalk.red; // Red
    }

    const indent = '  '.repeat(level);
    // Use a cleaner format that separates the title from the handle
    consola.log(`${indent}${color.bold(`◆ ${message}`)}`);
    consola.log(`${indent}  ${chalk.bold(title)} ${chalk.dim(`(${handle})`)}`);
  }

  /**
   * Format a success message with proper indentation and symbol
   * @param {string} message - Log message
   * @param {string} level - Indentation level (0, 1, 2, etc.)
   */
  static success(message, level = 0) {
    const indent = '  '.repeat(level);
    // Use green checkmark ✓ with consistent formatting
    consola.log(`${indent}${chalk.green('✓')} ${message}`);
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
      console.log(`${indent}${chalk.red('✖')} ${message}`, data);
    } else {
      console.log(`${indent}${chalk.red('✖')} ${message}`);
    }
  }

  /**
   * Format a warning message with proper indentation and symbol
   * @param {string} message - Log message
   * @param {string} level - Indentation level (0, 1, 2, etc.)
   */
  static warn(message, level = 0) {
    const indent = '  '.repeat(level);
    console.log(`${indent}${chalk.yellow('⚠')} ${message}`);
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

    console.log(`${indent}${symbol} ${message}`);
  }

  /**
   * Format a subdued message with proper indentation (for less important info like cursor data)
   * @param {string} message - Log message
   * @param {string} level - Indentation level (0, 1, 2, etc.)
   */
  static subdued(message, level = 0) {
    const indent = '  '.repeat(level);
    consola.log(`${indent}${chalk.gray(message)}`);
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
