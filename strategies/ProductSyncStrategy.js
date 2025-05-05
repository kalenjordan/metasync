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
 * TODO: Refactoring Plan
 * This class has grown too large and should be refactored into smaller, more focused classes:
 *
 * 1. Extract specialized handlers:
 *    - ProductImageHandler - image uploading, synchronization, variant image association
 *    - ProductMetafieldHandler - metafield batching and synchronization
 *    - ProductVariantHandler - variant creation, updating, image association
 *    - ProductPublicationHandler - channel and publication management
 *
 * 2. Create utilities:
 *    - ShopifyIDUtils - ID parsing, conversion, normalization
 *    - LoggerUtils - consistent log formatting and hierarchy
 *
 * 3. Convert to composition pattern:
 *    - Have ProductSyncStrategy use these specialized handlers
 *    - Share client instances and options between handlers
 *    - Maintain consistent logging patterns across handlers
 */
const consola = require('consola');
const { SHOPIFY_API_VERSION } = require('../constants');

// Import utility classes
const MetafieldHandler = require('../utils/MetafieldHandler');
const ProductImageHandler = require('../utils/ProductImageHandler');
const ShopifyIDUtils = require('../utils/ShopifyIDUtils');
const ProductPublicationHandler = require('../utils/ProductPublicationHandler');
const ProductBaseHandler = require('../utils/ProductBaseHandler');
const LoggingUtils = require('../utils/LoggingUtils');
const ProductVariantHandler = require('../utils/ProductVariantHandler');

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
    // Construct the GraphQL query for products
    // If handle is provided, we'll fetch just that specific product
    let query;
    let variables;

    if (options.handle) {
      // If fetching by handle, use the getProductByHandle method
      const product = await this.getProductByHandle(client, options.handle);
      return product ? [product] : [];
    } else {
      // Otherwise fetch multiple products
      query = `#graphql
        query GetProducts($first: Int!, $query: String) {
          products(first: $first, query: $query) {
            edges {
              node {
                id
                title
                handle
                description
                descriptionHtml
                vendor
                productType
                status
                tags
                options {
                  name
                  values
                }
                publications(first: 20) {
                  edges {
                    node {
                      channel {
                        id
                        name
                        handle
                      }
                      publishDate
                      isPublished
                    }
                  }
                }
                images(first: 10) {
                  edges {
                    node {
                      id
                      src
                      altText
                      width
                      height
                    }
                  }
                }
                variants(first: 100) {
                  edges {
                    node {
                      id
                      title
                      sku
                      price
                      compareAtPrice
                      inventoryQuantity
                      inventoryPolicy
                      inventoryItem {
                        id
                        tracked
                        requiresShipping
                        measurement {
                          weight {
                            value
                            unit
                          }
                        }
                      }
                      taxable
                      barcode
                      selectedOptions {
                        name
                        value
                      }
                      image {
                        id
                        src
                        altText
                        width
                        height
                      }
                      metafields(first: 50) {
                        edges {
                          node {
                            id
                            namespace
                            key
                            value
                            type
                          }
                        }
                      }
                    }
                  }
                }
                metafields(first: 100) {
                  edges {
                    node {
                      id
                      namespace
                      key
                      value
                      type
                    }
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      // Filter out archived products using the query parameter
      variables = {
        first: limit,
        query: "status:ACTIVE" // Only fetch active products
      };
    }

    try {
      const response = await client.graphql(query, variables, 'GetProducts');
      return response.products.edges.map(edge => {
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
    } catch (error) {
      consola.error(`Error fetching products: ${error.message}`);
      return [];
    }
  }

  async getProductByHandle(client, handle) {
    const query = `#graphql
      query GetProductByHandle($handle: String!) {
        productByHandle(handle: $handle) {
          id
          title
          handle
          description
          descriptionHtml
          vendor
          productType
          status
          tags
          options {
            name
            values
          }
          publications(first: 20) {
            edges {
              node {
                channel {
                  id
                  name
                  handle
                }
                publishDate
                isPublished
              }
            }
          }
          images(first: 10) {
            edges {
              node {
                id
                src
                altText
                width
                height
              }
            }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                price
                compareAtPrice
                inventoryQuantity
                inventoryPolicy
                inventoryItem {
                  id
                  tracked
                  requiresShipping
                  measurement {
                    weight {
                      value
                      unit
                    }
                  }
                }
                taxable
                barcode
                selectedOptions {
                  name
                  value
                }
                image {
                  id
                  src
                  altText
                  width
                  height
                }
                metafields(first: 50) {
                  edges {
                    node {
                      id
                      namespace
                      key
                      value
                      type
                    }
                  }
                }
              }
            }
          }
          metafields(first: 100) {
            edges {
              node {
                id
                namespace
                key
                value
                type
              }
            }
          }
        }
      }
    `;

    try {
      const response = await client.graphql(query, { handle }, 'GetProductByHandle');

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

        // Step 4: Create metafields if any
        if (newProduct.id && product.metafields && product.metafields.length > 0) {
          await this.metafieldHandler.syncMetafields(newProduct.id, product.metafields);
        }

        // Step 5: Sync publication status if any
        if (newProduct.id && product.publications && product.publications.length > 0) {
          await this.publicationHandler.syncProductPublications(newProduct.id, product.publications);
        }

        return newProduct;
      } catch (error) {
        LoggingUtils.error(`Error creating product "${product.title}": ${error.message}`, 2);
        return null;
      }
    } else {
      LoggingUtils.info(`[DRY RUN] Would create product "${product.title}"`, 1, 'main');
      LoggingUtils.info(`[DRY RUN] Would create ${product.variants ? product.variants.length : 0} variant(s)`, 2);
      LoggingUtils.info(`[DRY RUN] Would sync ${product.images ? product.images.length : 0} image(s) and ${product.metafields ? product.metafields.length : 0} metafield(s)`, 2);

      if (product.publications && product.publications.length > 0) {
        const publishedChannels = product.publications
          .filter(pub => pub.isPublished)
          .map(pub => pub.channel.handle);
        LoggingUtils.info(`[DRY RUN] Would publish to ${publishedChannels.length} channels: ${publishedChannels.join(', ')}`, 2);
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
          LoggingUtils.info(`No variants to update for "${product.title}"`, 2);
        }

        // Step 2: Sync images and metafields
        if (updatedProduct.id) {
          // Update images if any
          if (product.images && product.images.length > 0) {
            await this.imageHandler.syncProductImages(updatedProduct.id, product.images);
          }

          // Update metafields if any
          if (product.metafields && product.metafields.length > 0) {
            await this.metafieldHandler.syncMetafields(updatedProduct.id, product.metafields);
          }

          // Sync publication status if any
          if (product.publications && product.publications.length > 0) {
            await this.publicationHandler.syncProductPublications(updatedProduct.id, product.publications);
          }
        }

        return updatedProduct;
      } catch (error) {
        LoggingUtils.error(`Error updating product "${product.title}": ${error.message}`, 2);
        return null;
      }
    } else {
      LoggingUtils.info(`[DRY RUN] Would update product "${product.title}"`, 1, 'main');
      LoggingUtils.info(`[DRY RUN] Would update ${product.variants ? product.variants.length : 0} variant(s)`, 2);
      LoggingUtils.info(`[DRY RUN] Would sync ${product.images ? product.images.length : 0} image(s) and ${product.metafields ? product.metafields.length : 0} metafield(s)`, 2);

      if (product.publications && product.publications.length > 0) {
        const publishedChannels = product.publications
          .filter(pub => pub.isPublished)
          .map(pub => pub.channel.handle);
        LoggingUtils.info(`[DRY RUN] Would publish to ${publishedChannels.length} channels: ${publishedChannels.join(', ')}`, 2);
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

    const sourceProducts = await this.fetchProducts(this.sourceClient, this.options.limit, options);
    consola.info(`Found ${sourceProducts.length} product(s) in source shop`);

    const results = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0 };
    let processedCount = 0;

    // Process each source product
    for (const product of sourceProducts) {
      if (processedCount >= this.options.limit) {
        consola.info(`Reached processing limit (${this.options.limit}). Stopping product sync.`);
        break;
      }

      // Add newline before each product for better readability
      consola.log('');

      // Check if product exists in target shop by handle
      const targetProduct = await this.getProductByHandle(this.targetClient, product.handle);

      // If force recreate is enabled and the product exists, delete it first
      if (this.forceRecreate && targetProduct) {
        LoggingUtils.logProductAction('Force recreating product', product.title, product.handle, 'force-recreate');
        const deleted = await this.productHandler.deleteProduct(targetProduct.id);
        if (deleted) {
          LoggingUtils.success('Successfully deleted existing product', 1);
          results.deleted++;
          // Now create the product instead of updating
          LoggingUtils.logProductAction('Creating product', product.title, product.handle, 'create');
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
        LoggingUtils.logProductAction('Updating product', product.title, product.handle, 'update');
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
        LoggingUtils.logProductAction('Creating product', product.title, product.handle, 'create');
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
    consola.log('');
    consola.success(`Finished syncing products. Results: ${results.created} created, ${results.updated} updated, ${results.deleted} force deleted, ${results.failed} failed`);
    return { definitionResults: results, dataResults: null };
  }
}

module.exports = ProductSyncStrategy;
