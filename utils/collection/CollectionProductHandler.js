const logger = require('../logger');

class CollectionProductHandler {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
  }

  /**
   * Fetch products associated with a collection
   * @param {Object} client - Shopify client
   * @param {String} collectionId - The collection ID
   * @param {Number} limit - Maximum number of products to fetch
   * @returns {Array} Array of product objects
   */
  async fetchCollectionProducts(client, collectionId, limit = 50) {
    logger.info(`Fetching products for collection ID: ${collectionId}`);

    const getCollectionProductsQuery = `#graphql
      query GetCollectionProducts($collectionId: ID!, $first: Int!, $after: String) {
        collection(id: $collectionId) {
          title
          handle
          products(first: $first, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                title
                handle
                productType
                vendor
                status
              }
            }
          }
        }
      }
    `;

    let products = [];
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage && (!limit || products.length < limit)) {
      try {
        const response = await client.graphql(
          getCollectionProductsQuery,
          {
            collectionId,
            first: 50,
            after: cursor
          },
          'GetCollectionProducts'
        );

        if (!response.collection) {
          logger.error(`Collection not found with ID: ${collectionId}`);
          break;
        }

        const collectionTitle = response.collection.title;
        const productEdges = response.collection.products.edges;
        const pageInfo = response.collection.products.pageInfo;

        products = products.concat(productEdges.map(edge => edge.node));

        logger.info(`Fetched ${productEdges.length} products for collection "${collectionTitle}"`);

        hasNextPage = pageInfo.hasNextPage;
        cursor = pageInfo.endCursor;

        // Limit check
        if (limit && products.length >= limit) {
          products = products.slice(0, limit);
          logger.info(`Reached product limit (${limit})`);
          break;
        }
      } catch (error) {
        logger.error(`Error fetching collection products: ${error.message}`);
        break;
      }
    }

    logger.info(`Total: ${products.length} products fetched for collection`);
    return products;
  }

  /**
   * Add products to a collection in the target shop
   * @param {String} collectionId - Target collection ID
   * @param {Array} productIds - Array of product IDs to add
   * @returns {Boolean} Success status
   */
  async addProductsToCollection(collectionId, productIds) {
    if (!productIds || productIds.length === 0) {
      logger.info(`No products to add to collection`);
      return true;
    }

    logger.info(`Adding ${productIds.length} products to collection`);

    const addProductsToCollectionMutation = `#graphql
      mutation CollectionAddProducts($id: ID!, $productIds: [ID!]!) {
        collectionAddProducts(id: $id, productIds: $productIds) {
          collection {
            id
            title
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    if (!this.options.notADrill) {
      logger.info(`[DRY RUN] Would add ${productIds.length} products to collection ID ${collectionId}`);
      return true;
    }

    try {
      // Process in batches of 50 (Shopify API limits)
      const batchSize = 50;
      let processedCount = 0;
      let failedCount = 0;

      for (let i = 0; i < productIds.length; i += batchSize) {
        const batch = productIds.slice(i, i + batchSize);
        logger.info(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(productIds.length / batchSize)} (${batch.length} products)`);

        const result = await this.targetClient.graphql(
          addProductsToCollectionMutation,
          { id: collectionId, productIds: batch },
          'CollectionAddProducts'
        );

        if (result.collectionAddProducts.userErrors.length > 0) {
          logger.error(`Errors adding products to collection:`);
          result.collectionAddProducts.userErrors.forEach(error => {
            logger.error(`  ${error.message}`);
          });
          failedCount += batch.length;
        } else {
          const collection = result.collectionAddProducts.collection;
          logger.success(`Added ${batch.length} products to collection "${collection.title}"`);
          processedCount += batch.length;
        }
      }

      logger.info(`Products added: ${processedCount}, Failed: ${failedCount}`);
      return failedCount === 0;
    } catch (error) {
      logger.error(`Error adding products to collection: ${error.message}`);
      return false;
    }
  }

  /**
   * Fetch existing products in a collection to avoid adding duplicates
   * @param {String} collectionId - The collection ID
   * @returns {Set} Set of product IDs already in the collection
   */
  async fetchExistingCollectionProductIds(collectionId) {
    logger.info(`Checking for existing products in target collection...`);

    const existingProductIds = new Set();
    const query = `#graphql
      query GetCollectionProducts($collectionId: ID!, $first: Int!, $after: String) {
        collection(id: $collectionId) {
          products(first: $first, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `;

    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      try {
        const response = await this.targetClient.graphql(
          query,
          {
            collectionId,
            first: 250,
            after: cursor
          },
          'GetCollectionProducts'
        );

        if (!response.collection) {
          logger.error(`Collection not found with ID: ${collectionId}`);
          break;
        }

        const productEdges = response.collection.products.edges;
        const pageInfo = response.collection.products.pageInfo;

        productEdges.forEach(edge => existingProductIds.add(edge.node.id));
        logger.info(`Found ${existingProductIds.size} existing products in target collection`);

        hasNextPage = pageInfo.hasNextPage;
        cursor = pageInfo.endCursor;
      } catch (error) {
        logger.error(`Error fetching existing collection products: ${error.message}`);
        break;
      }
    }

    return existingProductIds;
  }

  /**
   * Synchronize products from source collection to target collection
   * @param {String} sourceCollectionId - Source collection ID
   * @param {String} targetCollectionId - Target collection ID
   * @returns {Boolean} Success status
   */
  async syncCollectionProducts(sourceCollectionId, targetCollectionId) {
    logger.info(`Syncing products between collections`);
    logger.indent();

    // Fetch products from source collection
    const sourceProducts = await this.fetchCollectionProducts(
      this.sourceClient,
      sourceCollectionId,
      this.options.limit || 250
    );

    if (sourceProducts.length === 0) {
      logger.info(`No products found in source collection`);
      logger.unindent();
      return true;
    }

    // Get matching products in target shop
    logger.info(`Looking for matching products in target shop...`);
    const sourceHandleToIdMap = {};
    const productHandles = sourceProducts.map(product => {
      sourceHandleToIdMap[product.handle] = product.id;
      return product.handle;
    });

    // Build query to find products by handle
    const queryChunks = [];
    for (let i = 0; i < productHandles.length; i += 50) {
      const handleChunk = productHandles.slice(i, i + 50);
      queryChunks.push(`(${handleChunk.map(h => `handle:${h}`).join(' OR ')})`);
    }

    const targetProducts = [];
    const targetProductIds = [];

    // Execute queries to find products in the target shop
    for (const queryChunk of queryChunks) {
      const query = `#graphql
        query GetProductsByHandles($query: String!) {
          products(first: 50, query: $query) {
            edges {
              node {
                id
                handle
                title
              }
            }
          }
        }
      `;

      try {
        const response = await this.targetClient.graphql(
          query,
          { query: queryChunk },
          'GetProductsByHandles'
        );

        const products = response.products.edges.map(edge => edge.node);
        targetProducts.push(...products);

        // Map each product to its ID
        products.forEach(product => {
          targetProductIds.push(product.id);
        });
      } catch (error) {
        logger.error(`Error fetching target products: ${error.message}`);
      }
    }

    logger.info(`Found ${targetProducts.length} matching products in target shop`);

    // Check for existing products in the target collection
    const existingProductIds = await this.fetchExistingCollectionProductIds(targetCollectionId);

    // Filter out products that are already in the collection
    const productsToAdd = targetProductIds.filter(id => !existingProductIds.has(id));

    if (productsToAdd.length === 0) {
      logger.info(`All products are already in the target collection - nothing to add`);
      logger.unindent();
      return true;
    }

    logger.info(`Adding ${productsToAdd.length} products to collection (${targetProductIds.length - productsToAdd.length} already exist)`);

    // Add products to the target collection
    if (productsToAdd.length > 0) {
      const success = await this.addProductsToCollection(targetCollectionId, productsToAdd);
      logger.unindent();
      return success;
    } else {
      logger.warn(`No matching products found in target shop to add to collection`);
      logger.unindent();
      return true;
    }
  }
}

module.exports = CollectionProductHandler;
