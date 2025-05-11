const logger = require("./logger");
/**
 * Product Metafield Processor
 *
 * Handles the processing of product metafields during sync operations,
 * including filtering, transformation, and syncing of metafields.
 */
const MetafieldFilterUtils = require('./MetafieldFilterUtils');

class ProductMetafieldProcessor {
  constructor(metafieldHandler, referenceHandler, options = {}) {
    this.metafieldHandler = metafieldHandler;
    this.referenceHandler = referenceHandler;
    this.options = options;
    this.debug = !!options.debug;
  }

  /**
   * Process and transform metafields for a product
   * @param {String} productId - The product ID
   * @param {Array} metafields - Raw metafields to process
   * @returns {Promise<Object>} - Stats about the metafield processing
   */
  async processProductMetafields(productId, metafields) {
    if (!metafields || metafields.length === 0) {
      return { processed: 0, transformed: 0, blanked: 0, errors: 0, warnings: 0 };
    }

    // Filter metafields based on namespace/key options
    const filteredMetafields = MetafieldFilterUtils.filterMetafields(metafields, this.options);

    // Transform reference metafields using the dedicated handler
    const { transformedMetafields, stats } = await this.referenceHandler.transformReferences(filteredMetafields);

    // Log the number of metafields before and after transformation
    logger.info(`Processing metafields: ${filteredMetafields.length} filtered, ` +
      `${stats.transformed} transformed, ${stats.blanked} blanked due to errors, ${stats.warnings} warnings`, 4);

    // Print each transformed metafield for debugging
    if (this.debug) {
      transformedMetafields.forEach(metafield => {
        // Skip logging blanked metafields
        if (metafield._blanked) {
          logger.info(`Metafield ${metafield.namespace}.${metafield.key} (${metafield.type}): [BLANKED]`, 6);
          return;
        }

        // Mark unsupported types differently
        if (metafield._unsupportedType) {
          logger.info(`Metafield ${metafield.namespace}.${metafield.key} (${metafield.type}): [UNSUPPORTED TYPE]`, 6);
          return;
        }

        const valuePreview = typeof metafield.value === 'string' ?
          `${metafield.value.substring(0, 30)}${metafield.value.length > 30 ? '...' : ''}` :
          String(metafield.value);
        logger.info(`Metafield ${metafield.namespace}.${metafield.key} (${metafield.type}): ${valuePreview}`, 6);
      });
    }

    await this.metafieldHandler.syncMetafields(productId, transformedMetafields);
    return stats;
  }
}

module.exports = ProductMetafieldProcessor;
