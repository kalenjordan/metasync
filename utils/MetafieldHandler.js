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

    consola.info(`${logPrefix}• Syncing ${metafields.length} metafields for ID: ${ownerId}`);

    // Split metafields into batches
    const metafieldBatches = [];
    for (let i = 0; i < metafields.length; i += this.batchSize) {
      metafieldBatches.push(metafields.slice(i, i + this.batchSize));
    }

    consola.info(`${logPrefix}  - Processing ${metafieldBatches.length} batches of metafields (max ${this.batchSize} per batch)`);

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
          consola.info(`${logPrefix}    - Processing batch ${batchIndex + 1}/${metafieldBatches.length} (${metafieldBatch.length} metafields)`);
          const result = await this.client.graphql(mutation, { metafields: metafieldsInput }, 'MetafieldsSet');

          if (result.metafieldsSet.userErrors.length > 0) {
            consola.error(`${logPrefix}    ✖ Failed to set metafields in batch ${batchIndex + 1}:`, result.metafieldsSet.userErrors);
            failedCount += metafieldBatch.length;
          } else {
            const metafieldCount = result.metafieldsSet.metafields.length;
            LoggingUtils.success(`Successfully set ${metafieldCount} metafields in batch ${batchIndex + 1}`, 4);
            successCount += metafieldCount;

            // Log individual metafields if debug is enabled
            if (this.debug) {
              result.metafieldsSet.metafields.forEach(metafield => {
                consola.debug(`${logPrefix}      - Set metafield ${metafield.namespace}.${metafield.key}`);
              });
            }
          }
        } catch (error) {
          consola.error(`${logPrefix}    ✖ Error setting metafields in batch ${batchIndex + 1}: ${error.message}`);
          failedCount += metafieldBatch.length;
        }
      } else {
        consola.info(`${logPrefix}    - [DRY RUN] Would set ${metafieldBatch.length} metafields in batch ${batchIndex + 1}`);

        // Log individual metafields if debug is enabled
        if (this.debug) {
          metafieldBatch.forEach(metafield => {
            consola.debug(`${logPrefix}      - [DRY RUN] Would set metafield ${metafield.namespace}.${metafield.key}`);
          });
        }
      }
    }

    // Return success status
    if (this.options.notADrill) {
      consola.info(`${logPrefix}  - Metafields sync complete: ${successCount} successful, ${failedCount} failed`);
      return failedCount === 0;
    } else {
      return true;
    }
  }
}

module.exports = MetafieldHandler;
