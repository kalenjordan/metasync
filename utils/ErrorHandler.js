/**
 * Error Handler Utilities
 *
 * Provides consistent error handling for Shopify GraphQL API responses.
 */
const logger = require('./logger');

class ErrorHandler {
  /**
   * Handle user errors from a Shopify GraphQL API mutation
   * @param {Array} userErrors - Array of user error objects from a GraphQL response
   * @param {Array} items - The corresponding data items that caused the errors
   * @param {Function} getItemDetails - Function to extract details from an item given its index
   * @param {string} batchInfo - Additional context about the current batch
   * @returns {number} - Number of errors handled
   */
  static handleGraphQLUserErrors(userErrors, items, getItemDetails, batchInfo = '') {
    if (!userErrors || userErrors.length === 0) return 0;

    // Log the overall error message
    logger.startSection(`Failed to process ${batchInfo}:`);

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
              logger.error(`${details.itemName}: ${err.message}`);

              // Log value preview if available
              if (details.valuePreview) {
                // Indent one more level for value preview
                logger.startSection();
                logger.error(`Value: ${details.valuePreview}`);
                logger.endSection();
              }
              return;
            }
          }
        }

        // Fallback for errors without proper field path or when details extraction fails
        logger.error(`Error: ${err.message}`);
      } catch (error) {
        // Ensure error handling doesn't break if something goes wrong
        logger.error(`Error: ${err.message}`);
      }
    });

    // Reset indentation after error handling
    logger.endSection();

    return userErrors.length;
  }
}

module.exports = ErrorHandler;
