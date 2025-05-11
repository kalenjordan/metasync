/**
 * logger - Logging Utilities
 *
 * Provides consistent log formatting for Shopify operations with:
 * - Indentation
 * - Symbols for operations and statuses
 * - Color coding
 */
const chalk = require('chalk');

// Static indentation level
let indentLevel = 0;

/**
 * Increase indentation level
 * @param {number} levels - Number of levels to indent (default: 1)
 */
function indent(levels = 1) {
  indentLevel += levels;
  return indentLevel;
}

/**
 * Decrease indentation level
 * @param {number} levels - Number of levels to unindent (default: 1)
 */
function unindent(levels = 1) {
  indentLevel = Math.max(0, indentLevel - levels);
  return indentLevel;
}

/**
 * Reset indentation level to zero
 */
function resetIndent() {
  indentLevel = 0;
}

/**
 * Get the current indentation string
 * @param {number} extraLevels - Additional levels to add temporarily (default: 0)
 * @returns {string} Indentation string
 */
function getIndent(extraLevels = 0) {
  return '  '.repeat(indentLevel + extraLevels);
}

/**
 * Create a formatted log for a main product action
 * @param {string} message - Log message
 * @param {string} title - Product title
 * @param {string} handle - Product handle
 * @param {string} type - Type of action (update, create, delete, etc.)
 * @param {number} extraIndent - Extra indentation levels (default: 0)
 */
function logProductAction(message, title, handle, type = 'update', extraIndent = 0) {
  let color = chalk.cyan; // Default cyan for update

  if (type === 'create') {
    color = chalk.green; // Green
  } else if (type === 'delete' || type === 'force-recreate') {
    color = chalk.yellow; // Yellow/amber
  } else if (type === 'error') {
    color = chalk.red; // Red
  }

  const indent = getIndent(extraIndent);
  // Use a cleaner format that separates the title from the handle
  console.log(`${indent}${color.bold(`◆ ${message}`)}`);
  console.log(`${indent}  ${chalk.bold(title)} ${chalk.dim(`(${handle})`)}`);
}

/**
 * Format a success message with proper indentation and symbol
 * @param {string} message - Log message
 * @param {number} extraIndent - Extra indentation levels (default: 0)
 */
function success(message, extraIndent = 0) {
  const indent = getIndent(extraIndent);
  // Use green checkmark ✓ with consistent formatting
  console.log(`${indent}${chalk.green('✓')} ${message}`);
}

/**
 * Format an error message with proper indentation and symbol
 * @param {string} message - Log message
 * @param {number} extraIndent - Extra indentation levels (default: 0)
 * @param {Object} data - Additional error data to log
 */
function error(message, extraIndent = 0, data = null) {
  const indent = getIndent(extraIndent);
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
function warn(message, extraIndent = 0) {
  const indent = getIndent(extraIndent);
  console.log(`${indent}${chalk.yellow('⚠')} ${message}`);
}

/**
 * Format an info message with proper indentation and symbol
 * @param {string} message - Log message
 * @param {number} extraIndent - Extra indentation levels (default: 0)
 * @param {string} type - Type of info (main, sub, detail)
 */
function info(message, extraIndent = 0, type = 'detail') {
  const indent = getIndent(extraIndent);
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
function subdued(message, extraIndent = 0) {
  const indent = getIndent(extraIndent);
  console.log(`${indent}${chalk.gray(message)}`);
}

/**
 * Format a dry run message with proper indentation
 * @param {string} message - Log message
 * @param {number} extraIndent - Extra indentation levels (default: 0)
 */
function dryRun(message, extraIndent = 0) {
  const indent = getIndent(extraIndent);
  // Use dimmed text with a muted blue color for dry run messages
  console.log(`${indent}${chalk.dim(' > [DRY RUN] ' + message)}`);
}

/**
 * Log a section header with proper formatting
 * @param {string} title - Section title
 */
function section(title) {
  console.log(`\n${chalk.bold.cyan(title)}`);
}

/**
 * Log a debug message with proper indentation
 * Only visible when debug mode is enabled
 * @param {string} message - Debug message
 * @param {number} extraIndent - Extra indentation levels (default: 0)
 */
function debug(message, extraIndent = 0) {
  const indent = getIndent(extraIndent);
  console.log(`${indent}${chalk.dim.blue('[DEBUG]')} ${message}`);
}

module.exports = {
  indent,
  unindent,
  resetIndent,
  getIndent,
  logProductAction,
  success,
  error,
  warn,
  info,
  subdued,
  dryRun,
  section,
  debug
};
