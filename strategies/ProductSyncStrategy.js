/**
 * Product Sync Strategy
 *
 * This strategy syncs products between Shopify stores, including:
 * - Basic product information (title, description, vendor, type, etc.)
 * - Product variants (with options, pricing, inventory, etc.)
 * - Product images (using productCreateMedia mutation)
 * - Product metafields
 *
 * Note that variant syncing is limited to basic attributes. For full variant syncing,
 * consider using the productVariantsBulkUpdate mutation separately.
 *
 * Weight information is stored in inventoryItem.measurement.weight according to latest Shopify Admin API.
 * Variant options are accessed via selectedOptions instead of deprecated option1/option2/option3 fields.
 *
 */
;

// Import utility classes
const MetafieldHandler = require('../utils/MetafieldHandler');
const ProductImageHandler = require('../utils/ProductImageHandler');
const ProductPublicationHandler = require('../utils/ProductPublicationHandler');
const ProductBaseHandler = require('../utils/ProductBaseHandler');
const logger = require('../utils/logger');
const ProductVariantHandler = require('../utils/ProductVariantHandler');
const MetafieldReferenceHandler = require('../utils/MetafieldReferenceHandler');
const ProductBatchProcessor = require('../utils/ProductBatchProcessor');
const SyncResultTracker = require('../utils/SyncResultTracker');
const ProductMetafieldProcessor = require('../utils/ProductMetafieldProcessor');
const ProductOperationHandler = require('../utils/ProductOperationHandler');

class ProductSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options || {};
    this.debug = options.debug;

    // Commander.js transforms --force-recreate to options.forceRecreate
    this.forceRecreate = !!options.forceRecreate;

    // Initialize utility handlers
    this.metafieldHandler = new MetafieldHandler(targetClient, options);
    this.imageHandler = new ProductImageHandler(targetClient, options);
    this.publicationHandler = new ProductPublicationHandler(targetClient, options);
    this.productHandler = new ProductBaseHandler(targetClient, options);

    // Pass dependencies to the variant handler
    this.variantHandler = new ProductVariantHandler(targetClient, options, {
      metafieldHandler: this.metafieldHandler,
      imageHandler: this.imageHandler
    });

    // Also create a source version of the product handler for fetching
    this.sourceProductHandler = new ProductBaseHandler(sourceClient, options);

    // Initialize the reference handler
    this.referenceHandler = new MetafieldReferenceHandler(sourceClient, targetClient, options, {
      variantHandler: this.variantHandler,
    });

    // Initialize new utility classes
    this.batchProcessor = new ProductBatchProcessor(sourceClient, options);
    this.metafieldProcessor = new ProductMetafieldProcessor(
      this.metafieldHandler,
      this.referenceHandler,
      options
    );
    this.productOperationHandler = new ProductOperationHandler(
      targetClient,
      this.productHandler,
      this.variantHandler,
      this.imageHandler,
      this.metafieldProcessor,
      this.publicationHandler,
      options
    );

    this.resultTracker = new SyncResultTracker();
  }

  // --- Sync Orchestration Methods ---

  async sync() {
    logger.info(`Syncing products...`);

    // Debug: Log all options to help diagnose issues
    if (this.debug) {
      logger.debug(`Options received by ProductSyncStrategy:`, this.options);
    }

    // Fetch products from source shop with options
    const options = {};

    // If a specific handle was provided, use it for filtering
    if (this.options.handle) {
      logger.info(`Syncing only product with handle: ${this.options.handle}`);
      options.handle = this.options.handle;
    }

    // Get the products iterator
    const productsIterator = await this.batchProcessor.fetchProducts(this.sourceClient, this.options.limit, options);

    // If we're dealing with a single product by handle, the result is already an array
    if (Array.isArray(productsIterator)) {
      await this.processSingleProduct(productsIterator);
    } else {
      await this.processBatchedProducts(productsIterator);
    }

    // Remove the log summary call to avoid duplication with the CLI output
    // The CLI will use the results from formatForStrategyResult to display the summary

    // Return results for the CLI to display
    return this.resultTracker.formatForStrategyResult();
  }

  /**
   * Process a single product by handle
   * @param {Array} sourceProducts - The source product(s) to process
   */
  async processSingleProduct(sourceProducts) {
    logger.info(`Found ${sourceProducts.length} product(s) in source shop`);

    let processedCount = 0;

    for (let i = 0; i < sourceProducts.length; i++) {
      const product = sourceProducts[i];
      // Add newline before each product for better readability
      console.log('');

      // Calculate the progress numbers - this is a single product operation
      const productNumInBatch = i + 1;
      const totalProcessed = processedCount + 1;

      // Check if product exists in target shop by handle
      const targetProduct = await this.batchProcessor.getProductByHandle(this.targetClient, product.handle);

      // Process the product based on whether it exists and forceRecreate option
      await this.processProduct(product, targetProduct, productNumInBatch, sourceProducts.length, totalProcessed);

      processedCount++;
    }
  }

  /**
   * Process batches of products
   * @param {Object} productsIterator - The batch iterator
   */
  async processBatchedProducts(productsIterator) {
    let processedCount = 0;
    let batchNumber = 1;

    // Process products in batches
    logger.info(`Started fetching products in batches of ${this.options.batchSize || 25}`);

    // Fetch the first batch
    let batchResult = await productsIterator.fetchNextBatch();

    if (batchResult.products.length === 0) {
      logger.info(`No products found in source shop`);
      return;
    }

    do {
      const sourceProducts = batchResult.products;
      // Add a proper empty line without an info icon
      console.log('');
      // Remove the \n from the beginning of this string
      logger.info(`Processing batch ${batchNumber}: ${sourceProducts.length} products (${batchResult.fetchedCount} total so far)`);

      // Process each source product in this batch
      for (let i = 0; i < sourceProducts.length; i++) {
        const product = sourceProducts[i];
        if (processedCount >= this.options.limit) {
          logger.info(`  Reached processing limit (${this.options.limit}). Stopping product sync.`);
          break;
        }

        // Add newline before each product for better readability
        console.log('');

        // Calculate the progress numbers
        const productNumInBatch = i + 1;
        const totalProcessed = processedCount + 1;

        // Check if product exists in target shop by handle
        const targetProduct = await this.batchProcessor.getProductByHandle(this.targetClient, product.handle);

        // Process the product based on whether it exists and forceRecreate option
        await this.processProduct(product, targetProduct, productNumInBatch, sourceProducts.length, totalProcessed);

        processedCount++;
      }

      batchNumber++;

      // Log the cursor at the end of each batch for potential resumption
      if (batchResult.cursor) {
        console.log('');
        logger.subdued(`Current batch end cursor: ${batchResult.cursor}`, 1);
      }

      // Fetch the next batch
      batchResult = await productsIterator.fetchNextBatch();

    } while (batchResult.products.length > 0 && !batchResult.done);
  }

  /**
   * Process a single product (create, update, or recreate)
   * @param {Object} product - The source product to process
   * @param {Object} targetProduct - The existing target product (if any)
   * @param {Number} productNumInBatch - Product number in current batch
   * @param {Number} batchSize - Size of current batch
   * @param {Number} totalProcessed - Total number of products processed so far
   */
  async processProduct(product, targetProduct, productNumInBatch, batchSize, totalProcessed) {
    // If force recreate is enabled and the product exists, delete it first
    if (this.forceRecreate && targetProduct) {
      logger.logProductAction(
        `Force recreating product (${productNumInBatch}/${batchSize}, total: ${totalProcessed})`,
        product.title,
        product.handle,
        'force-recreate',
        1
      );

      const deleted = await this.productHandler.deleteProduct(targetProduct.id);

      if (deleted) {
        logger.success('Successfully deleted existing product', 2);
        this.resultTracker.trackDeletion();

        // Now create the product instead of updating
        logger.logProductAction(
          `Creating product (${productNumInBatch}/${batchSize}, total: ${totalProcessed})`,
          product.title,
          product.handle,
          'create',
          1
        );

        const createResult = await this.productOperationHandler.createProduct(product);

        if (createResult) {
          logger.success('Product created successfully', 2);
          this.resultTracker.trackCreation(createResult);
        } else {
          logger.error('Failed to create product', 2);
          this.resultTracker.trackFailure();
        }
      } else {
        logger.error('Failed to delete existing product', 2);
        logger.info('Attempting to update instead', 2);

        const updateResult = await this.productOperationHandler.updateProduct(product, targetProduct);

        if (updateResult) {
          logger.success('Product updated successfully', 2);
          this.resultTracker.trackUpdate(updateResult);
        } else {
          logger.error('Failed to update product', 2);
          this.resultTracker.trackFailure();
        }
      }
    } else if (targetProduct) {
      // Update existing product
      logger.logProductAction(
        `Updating product (${productNumInBatch}/${batchSize}, total: ${totalProcessed})`,
        product.title,
        product.handle,
        'update',
        1
      );

      const updateResult = await this.productOperationHandler.updateProduct(product, targetProduct);

      if (updateResult) {
        logger.success('Product updated successfully', 2);
        this.resultTracker.trackUpdate(updateResult);
      } else {
        logger.error('Failed to update product', 2);
        this.resultTracker.trackFailure();
      }
    } else {
      // Create new product
      logger.logProductAction(
        `Creating product (${productNumInBatch}/${batchSize}, total: ${totalProcessed})`,
        product.title,
        product.handle,
        'create',
        1
      );

      const createResult = await this.productOperationHandler.createProduct(product);

      if (createResult) {
        logger.success('Product created successfully', 2);
        this.resultTracker.trackCreation(createResult);
      } else {
        logger.error('Failed to create product', 2);
        this.resultTracker.trackFailure();
      }
    }
  }
}

module.exports = ProductSyncStrategy;
