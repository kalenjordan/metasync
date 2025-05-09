/**
 * Error Handler Utilities
 *
 * Provides consistent error handling for Shopify GraphQL API responses.
 */
const LoggingUtils = require('./LoggingUtils');

class ErrorHandler {
  /**
   * Handle user errors from a Shopify GraphQL API mutation
   * @param {Array} userErrors - Array of user error objects from a GraphQL response
   * @param {Array} items - The corresponding data items that caused the errors
   * @param {Function} getItemDetails - Function to extract details from an item given its index
   * @param {string} batchInfo - Additional context about the current batch
   * @param {number} indentLevel - Indentation level for log messages
   * @returns {number} - Number of errors handled
   */
  static handleGraphQLUserErrors(userErrors, items, getItemDetails, batchInfo = '', indentLevel = 4) {
    if (!userErrors || userErrors.length === 0) return 0;

    // Log the overall error message
    LoggingUtils.error(`Failed to process ${batchInfo}:`, indentLevel);

    // Handle each user error
    userErrors.forEach(err => {
      try {
        // Check if we have field path information (common in Shopify API errors)
        if (err.field && err.field.length >= 2) {
          // Many Shopify errors use a path like ['metafields', '8', 'value']
          // where the second element is the array index
          const itemIndex = parseInt(err.field[1]);

          if (!isNaN(itemIndex) && itemIndex < items.length) {
            // Extract item details using the provided function
            const details = getItemDetails(items[itemIndex], itemIndex, err.field);
            if (details) {
              // Log detailed error with item information
              LoggingUtils.error(`  - ${details.itemName}: ${err.message}`, indentLevel);

              // Log value preview if available
              if (details.valuePreview) {
                LoggingUtils.error(`    Value: ${details.valuePreview}`, indentLevel);
              }
              return;
            }
          }
        }

        // Fallback for errors without proper field path or when details extraction fails
        LoggingUtils.error(`  - Error: ${err.message}`, indentLevel);
      } catch (error) {
        // Ensure error handling doesn't break if something goes wrong
        LoggingUtils.error(`  - Error: ${err.message}`, indentLevel);
      }
    });

    return userErrors.length;
  }
}

module.exports = ErrorHandler;
