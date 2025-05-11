const logger = require("./logger");
/**
 * Product Batch Processor
 *
 * Handles batch processing of products during sync operations.
 * Provides a pagination-aware product fetcher and batch processing utilities.
 */
;
const chalk = require('chalk');

class ProductBatchProcessor {
  constructor(sourceClient, options = {}) {
    this.sourceClient = sourceClient;
    this.options = options;
    this.debug = !!options.debug;
    this.batchSize = options.batchSize || 25;
  }

  /**
   * Fetches products in batches with pagination support
   * @param {Object} client - Shopify client
   * @param {Number} limit - Maximum number of products to fetch
   * @param {Object} options - Additional options (handle, etc.)
   * @returns {Object} - An async batch fetcher object
   */
  async fetchProducts(client, limit = 50, options = {}) {
    // If fetching by handle, use the getProductByHandle method
    if (options.handle) {
      const product = await this.getProductByHandle(client, options.handle);
      return product ? [product] : [];
    }

    // For pagination, we'll use the configured batch size
    let hasNextPage = true;
    // Initialize cursor from options if provided
    let cursor = this.options.startCursor || null;
    let fetchedCount = 0;

    if (cursor) {
      logger.info(`Starting pagination from cursor: ${chalk.blue(cursor)}`);
    }

    // Return an async generator function
    return {
      // Method to fetch the next batch
      fetchNextBatch: async () => {
        if (!hasNextPage || fetchedCount >= limit) {
          return { products: [], done: true };
        }

        try {
          // Calculate how many products to fetch in this batch
          const fetchCount = Math.min(this.batchSize, limit - fetchedCount);

          // Filter out archived products using the query parameter
          const variables = {
            first: fetchCount,
            query: "status:ACTIVE", // Only fetch active products
            after: cursor
          };

          const response = await client.graphql(require('../graphql').GetProducts, variables, 'GetProducts');

          // Process products
          const batchProducts = response.products.edges.map(edge => {
            const product = edge.node;

            // Process images
            product.images = product.images.edges.map(imgEdge => imgEdge.node);

            // Process variants and their metafields
            product.variants = product.variants.edges.map(varEdge => {
              const variant = varEdge.node;

              // Process variant metafields
              if (variant.metafields && variant.metafields.edges) {
                variant.metafields = variant.metafields.edges.map(metaEdge => metaEdge.node);
              } else {
                variant.metafields = [];
              }

              return variant;
            });

            // Process metafields
            product.metafields = product.metafields.edges.map(metaEdge => metaEdge.node);

            // Process publications
            if (product.publications && product.publications.edges) {
              product.publications = product.publications.edges.map(pubEdge => pubEdge.node);
            } else {
              product.publications = [];
            }

            return product;
          });

          // Update pagination info for next iteration
          hasNextPage = response.products.pageInfo.hasNextPage;
          cursor = response.products.pageInfo.endCursor;
          fetchedCount += batchProducts.length;

          // Log the current cursor in gray for reference
          if (this.debug) {
            logger.debug(`Current pagination cursor: ${cursor}`);
          }

          return {
            products: batchProducts,
            done: !hasNextPage || fetchedCount > limit,
            fetchedCount,
            totalCount: fetchedCount,
            cursor: cursor
          };
        } catch (error) {
          logger.error(`Error fetching products: ${error.message}`);
          return { products: [], done: true, error: error.message };
        }
      }
    };
  }

  /**
   * Fetch a product by its handle
   */
  async getProductByHandle(client, handle) {
    try {
      const response = await client.graphql(require('../graphql').GetProductByHandle, { handle }, 'GetProductByHandle');

      if (!response.productByHandle) {
        return null;
      }

      const product = response.productByHandle;

      // Process images
      product.images = product.images.edges.map(imgEdge => imgEdge.node);

      // Process variants and their metafields
      product.variants = product.variants.edges.map(varEdge => {
        const variant = varEdge.node;

        // Process variant metafields
        if (variant.metafields && variant.metafields.edges) {
          variant.metafields = variant.metafields.edges.map(metaEdge => metaEdge.node);
        } else {
          variant.metafields = [];
        }

        return variant;
      });

      // Process metafields
      product.metafields = product.metafields.edges.map(metaEdge => metaEdge.node);

      // Process publications
      if (product.publications && product.publications.edges) {
        product.publications = product.publications.edges.map(pubEdge => pubEdge.node);
      } else {
        product.publications = [];
      }

      return product;
    } catch (error) {
      logger.error(`Error fetching product by handle: ${error.message}`);
      return null;
    }
  }

  /**
   * Gets a collection by its handle
   */
  async getCollectionByHandle(client, handle) {
    try {
      const response = await client.graphql(require('../graphql').GetCollectionByHandle, { handle }, 'GetCollectionByHandle');
      return response.collectionByHandle;
    } catch (error) {
      logger.error(`Error fetching collection by handle: ${error.message}`, 4);
      return null;
    }
  }

  /**
   * Gets a collection by its ID
   * @param {Object} client - Shopify client
   * @param {String} id - Collection ID
   * @returns {Promise<Object>} Collection object with handle
   */
  async getCollectionById(client, id) {
    try {
      const response = await client.graphql(require('../graphql').GetCollectionById, { id }, 'GetCollectionById');
      return response.collection;
    } catch (error) {
      logger.error(`Could not find collection for ID: ${id}`, 4);
      return null;
    }
  }
}

module.exports = ProductBatchProcessor;
