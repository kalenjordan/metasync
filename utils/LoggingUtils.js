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
  static indentLevel = 0;

  /**
   * Increase indentation level
   * @param {number} levels - Number of levels to indent (default: 1)
   */
  static indent(levels = 1) {
    this.indentLevel += levels;
    return this.indentLevel;
  }

  /**
   * Decrease indentation level
   * @param {number} levels - Number of levels to unindent (default: 1)
   */
  static unindent(levels = 1) {
    this.indentLevel = Math.max(0, this.indentLevel - levels);
    return this.indentLevel;
  }

  /**
   * Reset indentation level to zero
   */
  static resetIndent() {
    this.indentLevel = 0;
  }

  /**
   * Get the current indentation string
   * @param {number} extraLevels - Additional levels to add temporarily (default: 0)
   * @returns {string} Indentation string
   */
  static getIndent(extraLevels = 0) {
    return '  '.repeat(this.indentLevel + extraLevels);
  }

  /**
   * Create a formatted log for a main product action
   * @param {string} message - Log message
   * @param {string} title - Product title
   * @param {string} handle - Product handle
   * @param {string} type - Type of action (update, create, delete, etc.)
   * @param {number} extraIndent - Extra indentation levels (default: 0)
   */
  static logProductAction(message, title, handle, type = 'update', extraIndent = 0) {
    let color = chalk.cyan; // Default cyan for update

    if (type === 'create') {
      color = chalk.green; // Green
    } else if (type === 'delete' || type === 'force-recreate') {
      color = chalk.yellow; // Yellow/amber
    } else if (type === 'error') {
      color = chalk.red; // Red
    }

    const indent = this.getIndent(extraIndent);
    // Use a cleaner format that separates the title from the handle
    consola.log(`${indent}${color.bold(`◆ ${message}`)}`);
    consola.log(`${indent}  ${chalk.bold(title)} ${chalk.dim(`(${handle})`)}`);
  }

  /**
   * Format a success message with proper indentation and symbol
   * @param {string} message - Log message
   * @param {number} extraIndent - Extra indentation levels (default: 0)
   */
  static success(message, extraIndent = 0) {
    const indent = this.getIndent(extraIndent);
    // Use green checkmark ✓ with consistent formatting
    consola.log(`${indent}${chalk.green('✓')} ${message}`);
  }

  /**
   * Format an error message with proper indentation and symbol
   * @param {string} message - Log message
   * @param {number} extraIndent - Extra indentation levels (default: 0)
   * @param {Object} data - Additional error data to log
   */
  static error(message, extraIndent = 0, data = null) {
    const indent = this.getIndent(extraIndent);
    if (data) {
      console.log(`${indent}${chalk.red('✖')} ${message}`, data);
    } else {
      console.log(`${indent}${chalk.red('✖')} ${message}`);
    }
  }

  /**
   * Format a warning message with proper indentation and symbol
   * @param {string} message - Log message
   * @param {number} extraIndent - Extra indentation levels (default: 0)
   */
  static warn(message, extraIndent = 0) {
    const indent = this.getIndent(extraIndent);
    console.log(`${indent}${chalk.yellow('⚠')} ${message}`);
  }

  /**
   * Format an info message with proper indentation and symbol
   * @param {string} message - Log message
   * @param {number} extraIndent - Extra indentation levels (default: 0)
   * @param {string} type - Type of info (main, sub, detail)
   */
  static info(message, extraIndent = 0, type = 'detail') {
    const indent = this.getIndent(extraIndent);
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
   * @param {number} extraIndent - Extra indentation levels (default: 0)
   */
  static subdued(message, extraIndent = 0) {
    const indent = this.getIndent(extraIndent);
    consola.log(`${indent}${chalk.gray(message)}`);
  }

  /**
   * Format a dry run message with proper indentation
   * @param {string} message - Log message
   * @param {number} extraIndent - Extra indentation levels (default: 0)
   */
  static dryRun(message, extraIndent = 0) {
    const indent = this.getIndent(extraIndent);
    // Use dimmed text with a muted blue color for dry run messages
    console.log(`${indent}${chalk.dim.cyan('⟫')} ${chalk.dim.blue('[DRY RUN]')} ${chalk.dim(message)}`);
  }

  /**
   * Log a section header with proper formatting
   * @param {string} title - Section title
   */
  static section(title) {
    console.log(`\n${chalk.bold.cyan(title)}`);
  }

  /**
   * Log a debug message with proper indentation
   * Only visible when debug mode is enabled
   * @param {string} message - Debug message
   * @param {number} extraIndent - Extra indentation levels (default: 0)
   */
  static debug(message, extraIndent = 0) {
    const indent = this.getIndent(extraIndent);
    consola.debug(`${indent}${message}`);
  }
}

module.exports = LoggingUtils;
