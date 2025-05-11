/**
 * Metafield Handler
 *
 * Handles batching and synchronization of metafields for various Shopify resources.
 * Supports batching to respect Shopify's 25-metafield-per-call limit.
 */
const consola = require('consola');
const LoggingUtils = require('./LoggingUtils');
const ErrorHandler = require('./ErrorHandler');

class MetafieldHandler {
  constructor(client, options = {}) {
    this.client = client;
    this.options = options;
    this.debug = options.debug;
    this.batchSize = 25; // Shopify's limit per API call
  }

  /**
   * Sync metafields for a product or other resource
   * @param {string} ownerId - The ID of the resource to which metafields belong
   * @param {Array} metafields - Array of metafield objects
   * @param {string} logPrefix - Prefix for log messages
   * @returns {boolean} - Success status
   */
  async syncMetafields(ownerId, metafields, logPrefix = '') {
    if (!metafields || metafields.length === 0) return true;

    // Log how many metafields we're syncing
    LoggingUtils.info(`Syncing ${metafields.length} metafields for ID: ${ownerId}`, 2, 'main');

    // Split metafields into batches of 25 (Shopify limit per metafieldsSet mutation)
    const metafieldBatches = [];
    const BATCH_SIZE = 25;

    // Create batches of metafields
    for (let i = 0; i < metafields.length; i += BATCH_SIZE) {
      metafieldBatches.push(metafields.slice(i, i + BATCH_SIZE));
    }

    LoggingUtils.info(`Processing ${metafieldBatches.length} batches of metafields (max ${BATCH_SIZE} per batch)`, 3);

    let successCount = 0;
    let failedCount = 0;

    // Process each batch
    for (let batchIndex = 0; batchIndex < metafieldBatches.length; batchIndex++) {
      const metafieldBatch = metafieldBatches[batchIndex];
      LoggingUtils.info(`Processing batch ${batchIndex + 1}/${metafieldBatches.length} (${metafieldBatch.length} metafields)`, 4);

      // Prepare metafields inputs for this batch
      const metafieldsInput = metafieldBatch.map(metafield => ({
        ownerId: ownerId,
        namespace: metafield.namespace,
        key: metafield.key,
        value: metafield.value,
        type: metafield.type
      }));

      const mutation = `#graphql
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              namespace
              key
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      if (this.options.notADrill) {
        try {
          const result = await this.client.graphql(mutation, { metafields: metafieldsInput }, 'MetafieldsSet');

          if (result.metafieldsSet.userErrors.length > 0) {
            // Use the generic error handler with a custom function to extract metafield details
            const getMetafieldDetails = (metafield) => {
              // Get a preview of the value (truncate if too long)
              let valuePreview = String(metafield.value);
              if (valuePreview.length > 50) {
                valuePreview = valuePreview.substring(0, 47) + '...';
              }

              return {
                itemName: `Metafield ${metafield.namespace}.${metafield.key} (${metafield.type})`,
                valuePreview: valuePreview
              };
            };

            // Handle the errors with our generic handler
            ErrorHandler.handleGraphQLUserErrors(
              result.metafieldsSet.userErrors,
              metafieldBatch,
              getMetafieldDetails,
              `batch ${batchIndex + 1}/${metafieldBatches.length}`,
              5
            );

            failedCount += metafieldBatch.length;
          } else {
            const metafieldCount = result.metafieldsSet.metafields.length;
            LoggingUtils.success(`Successfully set ${metafieldCount} metafields in batch ${batchIndex + 1}`, 4);
            successCount += metafieldCount;

            // Log individual metafields if debug is enabled
            if (this.debug) {
              result.metafieldsSet.metafields.forEach(metafield => {
                consola.debug(`Set metafield ${metafield.namespace}.${metafield.key}`);
              });
            }
          }
        } catch (error) {
          LoggingUtils.error(`Error setting metafields in batch ${batchIndex + 1}: ${error.message}`, 5);
          failedCount += metafieldBatch.length;
        }
      } else {
        LoggingUtils.info(`[DRY RUN] Would set ${metafieldBatch.length} metafields in batch ${batchIndex + 1}`, 5);

        // Log individual metafields if debug is enabled
        if (this.debug) {
          metafieldBatch.forEach(metafield => {
            consola.debug(`[DRY RUN] Would set metafield ${metafield.namespace}.${metafield.key}`);
          });
        }
      }
    }

    // Return success status
    if (this.options.notADrill) {
      LoggingUtils.info(`Metafields sync complete: ${successCount} successful, ${failedCount} failed`, 4);
      return failedCount === 0;
    } else {
      return true;
    }
  }
}

module.exports = MetafieldHandler;
