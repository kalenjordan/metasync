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
 * @returns {string} Indentation string
 */
function getIndent() {
  return '  '.repeat(indentLevel);
}

/**
 * Create a formatted log for a main product action
 * This function also automatically indents after logging to create visual hierarchy
 * @param {string} message - Log message
 * @param {string} title - Product title
 * @param {string} handle - Product handle
 * @param {string} type - Type of action (update, create, delete, etc.)
 */
function logProductAction(message, title, handle, type = 'update') {
  let color = chalk.cyan; // Default cyan for update

  if (type === 'create') {
    color = chalk.green; // Green
  } else if (type === 'delete' || type === 'force-recreate') {
    color = chalk.yellow; // Yellow/amber
  } else if (type === 'error') {
    color = chalk.red; // Red
  }

  const indent = getIndent();
  // Use a cleaner format that separates the title from the handle
  console.log(`${indent}${color.bold(`◆ ${message}`)}`);
  console.log(`${indent}  ${chalk.bold(title)} ${chalk.dim(`(${handle})`)}`);

  // Automatically indent to create visual hierarchy for operations on this product
  indentLevel++;
}

/**
 * End the product action section and unindent
 * This should be called after all operations for a product are completed
 */
function endProductAction() {
  // Unindent to return to the previous level
  unindent();
}

/**
 * Format a success message with proper indentation and symbol
 * @param {string} message - Log message
 */
function success(message) {
  const indent = getIndent();
  // Use green checkmark ✓ with consistent formatting
  console.log(`${indent}${chalk.green('✓')} ${message}`);
}

/**
 * Format an error message with proper indentation and symbol
 * @param {string} message - Log message
 * @param {Object} data - Additional error data to log
 */
function error(message, data = null) {
  const indent = getIndent();
  if (data) {
    console.log(`${indent}${chalk.red('✖')} ${message}`, data);
  } else {
    console.log(`${indent}${chalk.red('✖')} ${message}`);
  }
}

/**
 * Format a warning message with proper indentation and symbol
 * @param {string} message - Log message
 */
function warn(message) {
  const indent = getIndent();
  console.log(`${indent}${chalk.yellow('⚠')} ${message}`);
}

/**
 * Format an info message with proper indentation and symbol
 * Symbol is automatically determined based on indentation level
 * @param {string} message - Log message
 */
function info(message) {
  const indent = getIndent();

  // Determine symbol based on indentation level:
  // Level 1: • (bullet)
  // Level 2: - (dash)
  // Level 3+: further dashes
  let symbol = '-'; // Default dash

  if (indentLevel === 1) {
    symbol = '•'; // Main operation - bullet point
  } else if (indentLevel >= 3) {
    symbol = '-'; // Sub-operation - dash
  } else {
    symbol = '-'; // Detail - dash
  }

  console.log(`${indent}${symbol} ${message}`);
}

/**
 * Format a subdued message with proper indentation (for less important info like cursor data)
 * @param {string} message - Log message
 */
function subdued(message) {
  const indent = getIndent();
  console.log(`${indent}${chalk.gray(message)}`);
}

/**
 * Format a dry run message with proper indentation
 * @param {string} message - Log message
 */
function dryRun(message) {
  const indent = getIndent();
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
 */
function debug(message) {
  const indent = getIndent();
  console.log(`${indent}${chalk.dim.blue('[DEBUG]')} ${message}`);
}

module.exports = {
  indent,
  unindent,
  resetIndent,
  getIndent,
  logProductAction,
  endProductAction,
  success,
  error,
  warn,
  info,
  subdued,
  dryRun,
  section,
  debug
};
