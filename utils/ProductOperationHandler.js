const logger = require("./logger");
/**
 * Product Operation Handler
 *
 * Handles creation and updating of products during sync operations.
 * Coordinates the complex process of syncing products with their related entities.
 */
const SyncResultTracker = require('./SyncResultTracker');

class ProductOperationHandler {
  constructor(
    targetClient,
    productHandler,
    variantHandler,
    imageHandler,
    metafieldProcessor,
    publicationHandler,
    options = {}
  ) {
    this.targetClient = targetClient;
    this.productHandler = productHandler;
    this.variantHandler = variantHandler;
    this.imageHandler = imageHandler;
    this.metafieldProcessor = metafieldProcessor;
    this.publicationHandler = publicationHandler;
    this.options = options;
    this.notADrill = !!options.notADrill;
  }

  /**
   * Create a new product in the target shop
   * @param {Object} product - Source product data to create
   * @returns {Promise<Object>} - Created product result
   */
  async createProduct(product) {
    // Prepare input with the correct ProductInput structure
    const productInput = {
      title: product.title,
      descriptionHtml: product.descriptionHtml,
      vendor: product.vendor,
      productType: product.productType,
      handle: product.handle,
      status: product.status || 'ACTIVE',
      tags: product.tags,
      productOptions: product.options.map(opt => ({
        name: opt.name,
        values: Array.isArray(opt.values) ? opt.values.map(value => ({ name: value })) : []
      }))
      // Don't include variants directly as we'll use productVariantsBulkCreate for better control
    };

    if (this.notADrill) {
      try {
        // Create the product using the productHandler and extract results
        const newProduct = await this.productHandler.createProduct(productInput);
        if (!newProduct) return null;

        // Initialize the results object to use throughout the method
        const results = {
          created: 1,
          updated: 0,
          skipped: 0,
          failed: 0,
          deleted: 0,
          metafields: {
            processed: 0,
            transformed: 0,
            blanked: 0,
            errors: 0,
            warnings: 0,
            unsupportedTypes: []
          }
        };

        // Step 2: Now create variants using productVariantsBulkCreate
        if (newProduct.id && product.variants && product.variants.length > 0) {
          await this.variantHandler.updateProductVariants(newProduct.id, product.variants);
        }

        // Step 3: Upload images if any
        if (newProduct.id && product.images && product.images.length > 0) {
          await this.imageHandler.syncProductImages(newProduct.id, product.images);
        }

        // Step 4: Process and create metafields
        const metafieldStats = await this.metafieldProcessor.processProductMetafields(newProduct.id, product.metafields);
        results.metafields.processed = metafieldStats.processed;
        results.metafields.transformed = metafieldStats.transformed;
        results.metafields.blanked = metafieldStats.blanked;
        results.metafields.errors = metafieldStats.errors;
        results.metafields.warnings = metafieldStats.warnings;
        results.metafields.unsupportedTypes = metafieldStats.unsupportedTypes || [];

        // Step 5: Sync publication status if any
        if (newProduct.id && product.publications && product.publications.length > 0) {
          await this.publicationHandler.syncProductPublications(newProduct.id, product.publications);
        }

        return {
          id: newProduct.id,
          title: newProduct.title,
          handle: newProduct.handle,
          results
        };
      } catch (error) {
        logger.error(`Error creating product "${product.title}": ${error.message}`);
        return null;
      }
    } else {
      logger.info(`[DRY RUN] Would create product "${product.title}"`, 'main');

      // Indent dry run details
      logger.indent();
      logger.info(`[DRY RUN] Would create ${product.variants ? product.variants.length : 0} variant(s)`);
      logger.info(`[DRY RUN] Would sync ${product.images ? product.images.length : 0} image(s) and ${product.metafields ? product.metafields.length : 0} metafield(s)`);

      if (product.publications && product.publications.length > 0) {
        const publishedChannels = product.publications
          .filter(pub => pub.isPublished)
          .map(pub => pub.channel.handle);
        logger.info(`[DRY RUN] Would publish to ${publishedChannels.length} channels: ${publishedChannels.join(', ')}`);
      }

      // Unindent after dry run details
      logger.unindent();

      return {
        id: "dry-run-id",
        title: product.title,
        handle: product.handle,
        results: {
          created: 1,
          updated: 0,
          skipped: 0,
          failed: 0,
          deleted: 0,
          metafields: {
            processed: 0,
            transformed: 0,
            blanked: 0,
            errors: 0,
            warnings: 0,
            unsupportedTypes: []
          }
        }
      };
    }
  }

  /**
   * Update an existing product in the target shop
   * @param {Object} product - Source product data to update with
   * @param {Object} existingProduct - Existing product data in target shop
   * @returns {Promise<Object>} - Updated product result
   */
  async updateProduct(product, existingProduct) {
    // Prepare input with the correct ProductUpdateInput structure
    const productUpdateInput = {
      title: product.title,
      descriptionHtml: product.descriptionHtml,
      vendor: product.vendor,
      productType: product.productType,
      status: product.status || 'ACTIVE',
      tags: product.tags
      // Don't include options or variants in update as they need special handling
    };

    if (this.notADrill) {
      try {
        // Update the product using the productHandler
        const updatedProduct = await this.productHandler.updateProduct(existingProduct.id, productUpdateInput);
        if (!updatedProduct) return null;

        // Initialize the results object to use throughout the method
        const results = {
          created: 0,
          updated: 1,
          skipped: 0,
          failed: 0,
          deleted: 0,
          metafields: {
            processed: 0,
            transformed: 0,
            blanked: 0,
            errors: 0,
            warnings: 0,
            unsupportedTypes: []
          }
        };

        // Step 1: Update variants separately using productVariantsBulkUpdate
        if (updatedProduct.id && product.variants && product.variants.length > 0) {
          await this.variantHandler.updateProductVariants(updatedProduct.id, product.variants);
        } else {
          logger.info(`No variants to update for "${product.title}"`);
        }

        // Step 2: Sync images
        if (updatedProduct.id && product.images && product.images.length > 0) {
          await this.imageHandler.syncProductImages(updatedProduct.id, product.images);
        }

        // Step 3: Process and update metafields
        const metafieldStats = await this.metafieldProcessor.processProductMetafields(updatedProduct.id, product.metafields);
        results.metafields.processed = metafieldStats.processed;
        results.metafields.transformed = metafieldStats.transformed;
        results.metafields.blanked = metafieldStats.blanked;
        results.metafields.errors = metafieldStats.errors;
        results.metafields.warnings = metafieldStats.warnings;
        results.metafields.unsupportedTypes = metafieldStats.unsupportedTypes || [];

        // Step 4: Sync publication status
        if (updatedProduct.id && product.publications && product.publications.length > 0) {
          await this.publicationHandler.syncProductPublications(updatedProduct.id, product.publications);
        }

        return {
          id: updatedProduct.id,
          title: updatedProduct.title,
          handle: updatedProduct.handle,
          results
        };
      } catch (error) {
        logger.error(`Error updating product "${product.title}": ${error.message}`);
        return null;
      }
    } else {
      logger.info(`[DRY RUN] Would update product "${product.title}"`, 'main');

      // Indent dry run details
      logger.indent();
      logger.info(`[DRY RUN] Would update ${product.variants ? product.variants.length : 0} variant(s)`);
      logger.info(`[DRY RUN] Would sync ${product.images ? product.images.length : 0} image(s) and ${product.metafields ? product.metafields.length : 0} metafield(s)`);

      if (product.publications && product.publications.length > 0) {
        const publishedChannels = product.publications
          .filter(pub => pub.isPublished)
          .map(pub => pub.channel.handle);
        logger.info(`[DRY RUN] Would publish to ${publishedChannels.length} channels: ${publishedChannels.join(', ')}`);
      }

      // Unindent after dry run details
      logger.unindent();

      return {
        id: existingProduct.id,
        title: product.title,
        handle: product.handle,
        results: {
          created: 0,
          updated: 1,
          skipped: 0,
          failed: 0,
          deleted: 0,
          metafields: {
            processed: 0,
            transformed: 0,
            blanked: 0,
            errors: 0,
            warnings: 0,
            unsupportedTypes: []
          }
        }
      };
    }
  }
}

module.exports = ProductOperationHandler;
