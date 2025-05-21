/**
 * logger - Logging Utilities
 *
 * Provides consistent log formatting for Shopify operations with:
 * - Indentation
 * - Symbols for operations and statuses
 * - Color coding
 * - File logging with timestamps
 */
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const stripAnsi = require('strip-ansi');

// Static indentation level
let indentLevel = 0;

// Log file stream
let logFileStream = null;
let logFilePath = null;

/**
 * Initialize logging to file with timestamped filename
 * Creates the logs directory if it doesn't exist
 */
function initializeLogFile() {
  // Create logs directory if it doesn't exist
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Generate timestamp for filename (YYYY-MM-DD_HH-MM-SS)
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/T/, '_')
    .replace(/\..+/, '')
    .replace(/:/g, '-');

  // Create log file name
  logFilePath = path.join(logsDir, `sync_${timestamp}.log`);

  // Open write stream
  logFileStream = fs.createWriteStream(logFilePath, { flags: 'a' });

  // Log initial information
  const startMessage = `=== Sync operation started at ${now.toLocaleString()} ===\n`;
  logFileStream.write(startMessage);

  return logFilePath;
}

/**
 * Close the log file stream
 */
function closeLogFile() {
  if (logFileStream) {
    const endMessage = `\n=== Sync operation completed at ${new Date().toLocaleString()} ===\n`;
    logFileStream.write(endMessage);
    logFileStream.end();
    logFileStream = null;
  }
}

/**
 * Log to both console and file
 * @param {string} message - Message to log
 */
function log(message) {
  // Log to console
  console.log(message);

  // Log to file (strip ANSI color codes)
  if (logFileStream) {
    logFileStream.write(stripAnsi(message) + '\n');
  }
}

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

function debug(message) {
  log(message);
}

/**
 * Increase indentation level
 * @param {number} levels - Number of levels to indent (default: 1)
 */
function startSection(message) {
  info(message);
  return indent();
}

function endSection(message) {
  if (message) {
    info(message);
  }

  if (indentLevel == 1) {
    newline();
  }

  unindent();
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
  const line1 = `${indent}${color.bold(`◆ ${message}`)}`;
  const line2 = `${indent}  ${chalk.bold(title)} ${chalk.dim(`(${handle})`)}`;

  log(line1);
  log(line2);

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
  log(`${indent}${chalk.green('✓')} ${message}`);
}

/**
 * Format an error message with proper indentation and symbol
 * @param {string} message - Log message
 * @param {Object} data - Additional error data to log
 */
function error(message, data = null) {
  const indent = getIndent();
  if (data) {
    log(`${indent}${chalk.red('✖')} ${message}`);
    console.log(data); // Log data to console
    if (logFileStream) {
      logFileStream.write(JSON.stringify(data, null, 2) + '\n'); // Write formatted data to file
    }
  } else {
    log(`${indent}${chalk.red('✖')} ${message}`);
  }
}

/**
 * Format a warning message with proper indentation and symbol
 * @param {string} message - Log message
 */
function warn(message) {
  const indent = getIndent();
  log(`${indent}${chalk.yellow('⚠')} ${message}`);
}

/**
 * Format an info message with proper indentation and symbol
 * Symbol is automatically determined based on indentation level
 * @param {string} message - Log message
 */
function info(message) {
  const indent = getIndent();

  // Top level logs (indentLevel 0) have no symbol
  if (indentLevel === 0) {
    log(`${message}`);
    return;
  }

  // Determine symbol based on indentation level:
  // Level 1: • (bullet)
  // Level 2+: - (dash)
  let symbol = '-'; // Default dash

  if (indentLevel === 1) {
    symbol = '•'; // Main operation - bullet point
  } else {
    symbol = '-'; // Detail - dash
  }

  log(`${indent}${symbol} ${message}`);
}

/**
 * Format a subdued message with proper indentation (for less important info like cursor data)
 * @param {string} message - Log message
 */
function subdued(message) {
  const indent = getIndent();
  log(`${indent}${chalk.gray(message)}`);
}

/**
 * Format a dry run message with proper indentation
 * @param {string} message - Log message
 */
function dryRun(message) {
  const indent = getIndent();
  // Use dimmed text with a muted blue color for dry run messages
  log(`${indent}${chalk.dim(' > [DRY RUN] ' + message)}`);
}

/**
 * Log a section header with proper formatting
 * @param {string} title - Section title
 */
function section(title) {
  log(`\n${chalk.bold.cyan(title)}`);
}

/**
 * Log a blank line with no symbols or prefixes
 */
function newline() {
  log('');
}

/**
 * Get the current log file path
 * @returns {string|null} Log file path or null if logging to file is not initialized
 */
function getLogFilePath() {
  return logFilePath;
}

module.exports = {
  initializeLogFile,
  closeLogFile,
  getLogFilePath,
  indent,
  unindent,
  startSection,
  endSection,
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
  debug,
  newline
};
