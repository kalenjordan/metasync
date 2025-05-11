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
const consola = require('consola');
const chalk = require('chalk');

// Import utility classes
const MetafieldHandler = require('../utils/MetafieldHandler');
const ProductImageHandler = require('../utils/ProductImageHandler');
const ProductPublicationHandler = require('../utils/ProductPublicationHandler');
const ProductBaseHandler = require('../utils/ProductBaseHandler');
const LoggingUtils = require('../utils/LoggingUtils');
const ProductVariantHandler = require('../utils/ProductVariantHandler');

// Import GraphQL queries
const {
  GetProducts,
  GetProductByHandle,
  GetCollectionByHandle,
  GetCollectionById
} = require('../graphql');

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
  }

  // --- Product Methods ---

  async fetchProducts(client, limit = 50, options = {}) {
    // If fetching by handle, use the getProductByHandle method
    if (options.handle) {
      const product = await this.getProductByHandle(client, options.handle);
      return product ? [product] : [];
    }

    // For pagination, we'll use a batch size of 25
    const batchSize = this.options.batchSize || 25;
    let hasNextPage = true;
    // Initialize cursor from options if provided
    let cursor = this.options.startCursor || null;
    let fetchedCount = 0;

    if (cursor) {
      consola.info(`Starting pagination from cursor: ${chalk.blue(cursor)}`);
    }

    // Return an async generator function
    return {
      // Method to fetch the next batch
      fetchNextBatch: async function() {
        if (!hasNextPage || fetchedCount >= limit) {
          return { products: [], done: true };
        }

        try {
          // Calculate how many products to fetch in this batch
          const fetchCount = Math.min(batchSize, limit - fetchedCount);

          // Filter out archived products using the query parameter
          const variables = {
            first: fetchCount,
            query: "status:ACTIVE", // Only fetch active products
            after: cursor
          };

          const response = await client.graphql(GetProducts, variables, 'GetProducts');

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

              // variant.image is already properly structured as a direct object
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
          consola.debug(`Current pagination cursor: ${cursor}`);

          return {
            products: batchProducts,
            done: !hasNextPage || fetchedCount > limit,
            fetchedCount,
            totalCount: fetchedCount,
            cursor: cursor
          };
        } catch (error) {
          consola.error(`Error fetching products: ${error.message}`);
          return { products: [], done: true, error: error.message };
        }
      }
    };
  }

  async getProductByHandle(client, handle) {
    try {
      const response = await client.graphql(GetProductByHandle, { handle }, 'GetProductByHandle');

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

        // variant.image is already properly structured as a direct object

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
      consola.error(`Error fetching product by handle: ${error.message}`);
      return null;
    }
  }

  async getCollectionByHandle(client, handle) {
    try {
      const response = await client.graphql(GetCollectionByHandle, { handle }, 'GetCollectionByHandle');
      return response.collectionByHandle;
    } catch (error) {
      LoggingUtils.error(`Error fetching collection by handle: ${error.message}`, 4);
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
      const response = await client.graphql(GetCollectionById, { id }, 'GetCollectionById');
      return response.collection;
    } catch (error) {
      LoggingUtils.error(`Could not find collection for ID: ${id}`, 4);
      return null;
    }
  }

  /**
   * Transform a single collection reference metafield
   * @param {Object} metafield - The metafield to transform
   * @returns {Promise<Object|null>} - Transformed metafield or null if failed
   */
  async transformSingleCollectionReference(metafield) {
    try {
      // Extract the source collection ID
      const sourceCollectionId = metafield.value;

      // Get the source collection handle
      const sourceCollection = await this.getCollectionById(this.sourceClient, sourceCollectionId);

      if (!sourceCollection) {
        return null;
      }

      const sourceHandle = sourceCollection.handle;
      LoggingUtils.info(`Found source collection handle: ${sourceHandle}`, 4);

      // Look up the collection in the target store by handle
      const targetCollection = await this.getCollectionByHandle(this.targetClient, sourceHandle);

      if (!targetCollection) {
        LoggingUtils.error(`Could not find target collection with handle: ${sourceHandle}`, 4);
        return null;
      }

      const targetId = targetCollection.id;
      LoggingUtils.info(`Found target collection ID: ${targetId}`, 4);

      // Return the transformed metafield with the target collection ID
      return {
        ...metafield,
        value: targetId
      };
    } catch (error) {
      LoggingUtils.error(`Error transforming collection reference: ${error.message}`, 4);
      return null;
    }
  }

  /**
   * Transform a list of collection references metafield
   * @param {Object} metafield - The metafield containing a list of collection references
   * @returns {Promise<Object|null>} - Transformed metafield or null if failed
   */
  async transformCollectionReferenceList(metafield) {
    try {
      // Parse the JSON array of collection IDs
      const sourceCollectionIds = JSON.parse(metafield.value);
      LoggingUtils.info(`Found ${sourceCollectionIds.length} source collection IDs in list`, 4);

      const targetCollectionIds = [];

      for (const sourceId of sourceCollectionIds) {
        // Get the source collection handle
        const sourceCollection = await this.getCollectionById(this.sourceClient, sourceId);

        if (!sourceCollection) {
          continue;
        }

        const sourceHandle = sourceCollection.handle;
        LoggingUtils.info(`Found source collection handle: ${sourceHandle} for ID: ${sourceId}`, 5);

        // Look up the collection in the target store by handle
        const targetCollection = await this.getCollectionByHandle(this.targetClient, sourceHandle);

        if (!targetCollection) {
          LoggingUtils.error(`Could not find target collection with handle: ${sourceHandle}`, 4);
          continue;
        }

        const targetId = targetCollection.id;
        LoggingUtils.info(`Found target collection ID: ${targetId} for handle: ${sourceHandle}`, 5);
        targetCollectionIds.push(targetId);
      }

      if (targetCollectionIds.length > 0) {
        const transformedValue = JSON.stringify(targetCollectionIds);
        return {
          ...metafield,
          value: transformedValue
        };
      } else {
        LoggingUtils.error(`Failed to transform any collections in list metafield: ${metafield.namespace}.${metafield.key}`, 4);
        return null;
      }
    } catch (error) {
      LoggingUtils.error(`Error transforming collection reference list: ${error.message}`, 4);
      return null;
    }
  }

  async transformCollectionReferenceMetafields(metafields) {
    const transformedMetafields = [];
    let regularCount = 0;
    let collectionCount = 0;
    let listCollectionCount = 0;
    let failedCount = 0;

    LoggingUtils.info(`Starting metafield transformation on ${metafields.length} metafields`, 4);

    for (const metafield of metafields) {
      // Handle regular metafields normally
      if (metafield.type !== 'collection_reference' && metafield.type !== 'list.collection_reference') {
        transformedMetafields.push(metafield);
        regularCount++;
        continue;
      }

      // Handle collection reference metafields
      if (metafield.type === 'collection_reference') {
        const transformedMetafield = await this.transformSingleCollectionReference(metafield);

        if (transformedMetafield) {
          transformedMetafields.push(transformedMetafield);
          collectionCount++;
        } else {
          failedCount++;
        }
      }
      // Handle list.collection_reference metafields
      else if (metafield.type === 'list.collection_reference') {
        const transformedMetafield = await this.transformCollectionReferenceList(metafield);

        if (transformedMetafield) {
          transformedMetafields.push(transformedMetafield);
          listCollectionCount++;
          LoggingUtils.info(`Transformed list.collection_reference metafield: ${metafield.namespace}.${metafield.key}`, 4);
        } else {
          failedCount++;
        }
      }
    }

    LoggingUtils.info(`Metafield transformation complete: ${regularCount} regular, ${collectionCount} collection refs, ${listCollectionCount} list refs, ${failedCount} failed`, 4);

    return transformedMetafields;
  }

  /**
   * Filter metafields based on namespace and key options
   * @param {Array} metafields - Array of metafields to filter
   * @returns {Array} - Filtered metafields
   */
  filterMetafields(metafields) {
    if (!this.options.namespace && !this.options.key) {
      return metafields;
    }

    LoggingUtils.info(`Filtering metafields by ${this.options.namespace ? 'namespace: ' + this.options.namespace : ''} ${this.options.key ? 'key: ' + this.options.key : ''}`, 4);

    const filteredMetafields = metafields.filter(metafield => {
      // Filter by namespace if provided
      if (this.options.namespace && metafield.namespace !== this.options.namespace) {
        return false;
      }

      // Filter by key if provided
      if (this.options.key) {
        // Handle case where key includes namespace (namespace.key format)
        if (this.options.key.includes('.')) {
          const [keyNamespace, keyName] = this.options.key.split('.');
          return metafield.namespace === keyNamespace && metafield.key === keyName;
        } else {
          // Key without namespace
          return metafield.key === this.options.key;
        }
      }

      return true;
    });

    LoggingUtils.info(`Filtered from ${metafields.length} to ${filteredMetafields.length} metafields`, 4);
    return filteredMetafields;
  }

  /**
   * Process and transform metafields for a product
   * @param {String} productId - The product ID
   * @param {Array} metafields - Raw metafields to process
   * @returns {Promise<void>}
   */
  async processProductMetafields(productId, metafields) {
    if (!metafields || metafields.length === 0) {
      return;
    }

    // Filter metafields based on namespace/key options
    const filteredMetafields = this.filterMetafields(metafields);

    // Transform collection_reference metafields
    const transformedMetafields = await this.transformCollectionReferenceMetafields(filteredMetafields);

    // Log the number of metafields before and after transformation
    LoggingUtils.info(`Processing metafields: ${filteredMetafields.length} filtered, ${transformedMetafields.length} after transformation`, 4);

    // Print each transformed metafield for debugging
    if (this.debug) {
      transformedMetafields.forEach(metafield => {
        const valuePreview = typeof metafield.value === 'string' ?
          `${metafield.value.substring(0, 30)}${metafield.value.length > 30 ? '...' : ''}` :
          String(metafield.value);
        LoggingUtils.info(`Metafield ${metafield.namespace}.${metafield.key} (${metafield.type}): ${valuePreview}`, 5);
      });
    }

    await this.metafieldHandler.syncMetafields(productId, transformedMetafields);
  }

  async createProduct(client, product) {
    // Step 1: First create the product with basic info (without variants)
    const productInput = {
      title: product.title,
      handle: product.handle,
      descriptionHtml: product.descriptionHtml,
      vendor: product.vendor,
      productType: product.productType,
      status: product.status || 'ACTIVE',
      tags: product.tags,
      // Format productOptions correctly with OptionValueCreateInput objects
      productOptions: product.options.map(option => ({
        name: option.name,
        values: option.values.map(value => ({
          name: value
        }))
      }))
    };

    if (this.options.notADrill) {
      try {
        // Create the product using the productHandler
        const newProduct = await this.productHandler.createProduct(productInput);
        if (!newProduct) return null;

        // Step 2: Now create variants using productVariantsBulkCreate
        if (newProduct.id && product.variants && product.variants.length > 0) {
          await this.updateProductVariants(client, newProduct.id, product.variants);
        }

        // Step 3: Upload images if any
        if (newProduct.id && product.images && product.images.length > 0) {
          await this.imageHandler.syncProductImages(newProduct.id, product.images);
        }

        // Step 4: Process and create metafields
        if (newProduct.id && product.metafields && product.metafields.length > 0) {
          await this.processProductMetafields(newProduct.id, product.metafields);
        }

        // Step 5: Sync publication status if any
        if (newProduct.id && product.publications && product.publications.length > 0) {
          await this.publicationHandler.syncProductPublications(newProduct.id, product.publications);
        }

        return newProduct;
      } catch (error) {
        LoggingUtils.error(`Error creating product "${product.title}": ${error.message}`, 3);
        return null;
      }
    } else {
      LoggingUtils.info(`[DRY RUN] Would create product "${product.title}"`, 3, 'main');
      LoggingUtils.info(`[DRY RUN] Would create ${product.variants ? product.variants.length : 0} variant(s)`, 4);
      LoggingUtils.info(`[DRY RUN] Would sync ${product.images ? product.images.length : 0} image(s) and ${product.metafields ? product.metafields.length : 0} metafield(s)`, 4);

      if (product.publications && product.publications.length > 0) {
        const publishedChannels = product.publications
          .filter(pub => pub.isPublished)
          .map(pub => pub.channel.handle);
        LoggingUtils.info(`[DRY RUN] Would publish to ${publishedChannels.length} channels: ${publishedChannels.join(', ')}`, 4);
      }

      return { id: "dry-run-id", title: product.title, handle: product.handle };
    }
  }

  async updateProduct(client, product, existingProduct) {
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

    if (this.options.notADrill) {
      try {
        // Update the product using the productHandler
        const updatedProduct = await this.productHandler.updateProduct(existingProduct.id, productUpdateInput);
        if (!updatedProduct) return null;

        // Step 1: Update variants separately using productVariantsBulkUpdate
        if (updatedProduct.id && product.variants && product.variants.length > 0) {
          await this.updateProductVariants(client, updatedProduct.id, product.variants);
        } else {
          LoggingUtils.info(`No variants to update for "${product.title}"`, 4);
        }

        // Step 2: Sync images
        if (updatedProduct.id && product.images && product.images.length > 0) {
          await this.imageHandler.syncProductImages(updatedProduct.id, product.images);
        }

        // Step 3: Process and update metafields
        if (updatedProduct.id && product.metafields && product.metafields.length > 0) {
          await this.processProductMetafields(updatedProduct.id, product.metafields);
        }

        // Step 4: Sync publication status
        if (updatedProduct.id && product.publications && product.publications.length > 0) {
          await this.publicationHandler.syncProductPublications(updatedProduct.id, product.publications);
        }

        return updatedProduct;
      } catch (error) {
        LoggingUtils.error(`Error updating product "${product.title}": ${error.message}`, 3);
        return null;
      }
    } else {
      LoggingUtils.info(`[DRY RUN] Would update product "${product.title}"`, 2, 'main');
      LoggingUtils.info(`[DRY RUN] Would update ${product.variants ? product.variants.length : 0} variant(s)`, 3);
      LoggingUtils.info(`[DRY RUN] Would sync ${product.images ? product.images.length : 0} image(s) and ${product.metafields ? product.metafields.length : 0} metafield(s)`, 4);

      if (product.publications && product.publications.length > 0) {
        const publishedChannels = product.publications
          .filter(pub => pub.isPublished)
          .map(pub => pub.channel.handle);
        LoggingUtils.info(`[DRY RUN] Would publish to ${publishedChannels.length} channels: ${publishedChannels.join(', ')}`, 4);
      }

      return { id: existingProduct.id, title: product.title, handle: product.handle };
    }
  }

  // Variant handling is now delegated to the VariantHandler class
  async updateProductVariants(client, productId, sourceVariants) {
    return await this.variantHandler.updateProductVariants(productId, sourceVariants);
  }

  // --- Sync Orchestration Methods ---

  async sync() {
    consola.start(`Syncing products...`);

    // Debug: Log all options to help diagnose issues
    if (this.debug) {
      consola.debug(`Options received by ProductSyncStrategy:`, this.options);
    }

    // Fetch products from source shop with options
    const options = {};

    // If a specific handle was provided, use it for filtering
    if (this.options.handle) {
      consola.info(`Syncing only product with handle: ${this.options.handle}`);
      options.handle = this.options.handle;
    }

    const productsIterator = await this.fetchProducts(this.sourceClient, this.options.limit, options);

    // If we're dealing with a single product by handle, the result is already an array
    if (Array.isArray(productsIterator)) {
      consola.info(`Found ${productsIterator.length} product(s) in source shop`);

      // Process the returned products directly (for single product by handle case)
      const sourceProducts = productsIterator;
      let processedCount = 0;
      const results = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0 };
      for (let i = 0; i < sourceProducts.length; i++) {
        const product = sourceProducts[i];
        // Add newline before each product for better readability
        console.log('');

        // Calculate the progress numbers - this is a single product operation
        const productNumInBatch = i + 1;
        const totalProcessed = processedCount + 1;

        // Check if product exists in target shop by handle
        const targetProduct = await this.getProductByHandle(this.targetClient, product.handle);

        // If force recreate is enabled and the product exists, delete it first
        if (this.forceRecreate && targetProduct) {
          LoggingUtils.logProductAction(`Force recreating product (${productNumInBatch}/${sourceProducts.length}, total: ${totalProcessed})`, product.title, product.handle, 'force-recreate');
          const deleted = await this.productHandler.deleteProduct(targetProduct.id);
          if (deleted) {
            LoggingUtils.success('Successfully deleted existing product', 1);
            results.deleted++;
            // Now create the product instead of updating
            LoggingUtils.logProductAction(`Creating product (${productNumInBatch}/${sourceProducts.length}, total: ${totalProcessed})`, product.title, product.handle, 'create');
            const created = await this.createProduct(this.targetClient, product);
            if (created) {
              LoggingUtils.success('Product created successfully', 1);
              results.created++;
            } else {
              LoggingUtils.error('Failed to create product', 1);
              results.failed++;
            }
          } else {
            LoggingUtils.error('Failed to delete existing product', 1);
            LoggingUtils.info('Attempting to update instead', 1);
            const updated = await this.updateProduct(this.targetClient, product, targetProduct);
            if (updated) {
              LoggingUtils.success('Product updated successfully', 1);
              results.updated++;
            } else {
              LoggingUtils.error('Failed to update product', 1);
              results.failed++;
            }
          }
        } else if (targetProduct) {
          // Update existing product
          LoggingUtils.logProductAction(`Updating product (${productNumInBatch}/${sourceProducts.length}, total: ${totalProcessed})`, product.title, product.handle, 'update');
          const updated = await this.updateProduct(this.targetClient, product, targetProduct);

          // Log result with proper indentation
          if (updated) {
            LoggingUtils.success('Product updated successfully', 1);
            results.updated++;
          } else {
            LoggingUtils.error('Failed to update product', 1);
            results.failed++;
          }
        } else {
          // Create new product
          LoggingUtils.logProductAction(`Creating product (${productNumInBatch}/${sourceProducts.length}, total: ${totalProcessed})`, product.title, product.handle, 'create');
          const created = await this.createProduct(this.targetClient, product);

          // Log result with proper indentation
          if (created) {
            LoggingUtils.success('Product created successfully', 1);
            results.created++;
          } else {
            LoggingUtils.error('Failed to create product', 1);
            results.failed++;
          }
        }

        processedCount++;
      }

      // Add a newline before summary
      console.log('');
      LoggingUtils.success(`Finished syncing products. Results: ${results.created} created, ${results.updated} updated, ${results.deleted} force deleted, ${results.failed} failed`, 0);
      return { definitionResults: results, dataResults: null };
    }

    // For batch processing of multiple products
    let processedCount = 0;
    let batchNumber = 1;

    // Process products in batches
    consola.info(`Started fetching products in batches of ${this.options.batchSize || 25}`);

    // Fetch the first batch
    let batchResult = await productsIterator.fetchNextBatch();

    if (batchResult.products.length === 0) {
      consola.info(`No products found in source shop`);
      return { definitionResults: results, dataResults: null };
    }

    do {
      const sourceProducts = batchResult.products;
      // Add a proper empty line without an info icon
      console.log('');
      // Remove the \n from the beginning of this string
      consola.info(`Processing batch ${batchNumber}: ${sourceProducts.length} products (${batchResult.fetchedCount} total so far)`);

      // Process each source product in this batch
      for (let i = 0; i < sourceProducts.length; i++) {
        const product = sourceProducts[i];
        if (processedCount >= this.options.limit) {
          consola.info(`  Reached processing limit (${this.options.limit}). Stopping product sync.`);
          break;
        }

        // Add newline before each product for better readability
        console.log('');

        // Calculate the progress numbers
        const productNumInBatch = i + 1;
        const totalProcessed = processedCount + 1;

        // Check if product exists in target shop by handle
        const targetProduct = await this.getProductByHandle(this.targetClient, product.handle);

        // If force recreate is enabled and the product exists, delete it first
        if (this.forceRecreate && targetProduct) {
          LoggingUtils.logProductAction(`Force recreating product (${productNumInBatch}/${sourceProducts.length}, total: ${totalProcessed})`, product.title, product.handle, 'force-recreate', 1);
          const deleted = await this.productHandler.deleteProduct(targetProduct.id);
          if (deleted) {
            LoggingUtils.success('Successfully deleted existing product', 2);
            results.deleted++;
            // Now create the product instead of updating
            LoggingUtils.logProductAction(`Creating product (${productNumInBatch}/${sourceProducts.length}, total: ${totalProcessed})`, product.title, product.handle, 'create', 1);
            const created = await this.createProduct(this.targetClient, product);
            if (created) {
              LoggingUtils.success('Product created successfully', 2);
              results.created++;
            } else {
              LoggingUtils.error('Failed to create product', 2);
              results.failed++;
            }
          } else {
            LoggingUtils.error('Failed to delete existing product', 2);
            LoggingUtils.info('Attempting to update instead', 2);
            const updated = await this.updateProduct(this.targetClient, product, targetProduct);
            if (updated) {
              LoggingUtils.success('Product updated successfully', 2);
              results.updated++;
            } else {
              LoggingUtils.error('Failed to update product', 2);
              results.failed++;
            }
          }
        } else if (targetProduct) {
          // Update existing product
          LoggingUtils.logProductAction(`Updating product (${productNumInBatch}/${sourceProducts.length}, total: ${totalProcessed})`, product.title, product.handle, 'update', 1);
          const updated = await this.updateProduct(this.targetClient, product, targetProduct);

          // Log result with proper indentation
          if (updated) {
            LoggingUtils.success('Product updated successfully', 2);
            results.updated++;
          } else {
            LoggingUtils.error('Failed to update product', 2);
            results.failed++;
          }
        } else {
          // Create new product
          LoggingUtils.logProductAction(`Creating product (${productNumInBatch}/${sourceProducts.length}, total: ${totalProcessed})`, product.title, product.handle, 'create', 1);
          const created = await this.createProduct(this.targetClient, product);

          // Log result with proper indentation
          if (created) {
            LoggingUtils.success('Product created successfully', 2);
            results.created++;
          } else {
            LoggingUtils.error('Failed to create product', 2);
            results.failed++;
          }
        }

        processedCount++;
      }

      batchNumber++;

      // Log the cursor at the end of each batch for potential resumption
      if (batchResult.cursor) {
        console.log('');
        LoggingUtils.subdued(`Current batch end cursor: ${batchResult.cursor}`, 1);
      }

      // Fetch the next batch
      batchResult = await productsIterator.fetchNextBatch();

    } while (batchResult.products.length > 0 && !batchResult.done);

    // Add a newline before summary
    console.log('');
    LoggingUtils.success(`Finished syncing products. Results: ${results.created} created, ${results.updated} updated, ${results.deleted} force deleted, ${results.failed} failed`, 0);
    return { definitionResults: results, dataResults: null };
  }
}

module.exports = ProductSyncStrategy;
