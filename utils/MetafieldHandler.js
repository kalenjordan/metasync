/**
 * Metafield Handler
 *
 * Handles batching and synchronization of metafields for various Shopify resources.
 * Supports batching to respect Shopify's 25-metafield-per-call limit.
 */
const consola = require('consola');
const LoggingUtils = require('./LoggingUtils');

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

    LoggingUtils.info(`Syncing ${metafields.length} metafields for ID: ${ownerId}`, 2, 'main');

    // Split metafields into batches
    const metafieldBatches = [];
    for (let i = 0; i < metafields.length; i += this.batchSize) {
      metafieldBatches.push(metafields.slice(i, i + this.batchSize));
    }

    LoggingUtils.info(`Processing ${metafieldBatches.length} batches of metafields (max ${this.batchSize} per batch)`, 3);

    let successCount = 0;
    let failedCount = 0;

    // Process each batch
    for (const [batchIndex, metafieldBatch] of metafieldBatches.entries()) {
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
          LoggingUtils.info(`Processing batch ${batchIndex + 1}/${metafieldBatches.length} (${metafieldBatch.length} metafields)`, 4);
          const result = await this.client.graphql(mutation, { metafields: metafieldsInput }, 'MetafieldsSet');

          if (result.metafieldsSet.userErrors.length > 0) {
            LoggingUtils.error(`Failed to set metafields in batch ${batchIndex + 1}:`, 4, result.metafieldsSet.userErrors);
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
          LoggingUtils.error(`Error setting metafields in batch ${batchIndex + 1}: ${error.message}`, 4);
          failedCount += metafieldBatch.length;
        }
      } else {
        LoggingUtils.info(`[DRY RUN] Would set ${metafieldBatch.length} metafields in batch ${batchIndex + 1}`, 4);

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
      LoggingUtils.info(`Metafields sync complete: ${successCount} successful, ${failedCount} failed`, 3);
      return failedCount === 0;
    } else {
      return true;
    }
  }
}

module.exports = MetafieldHandler;
