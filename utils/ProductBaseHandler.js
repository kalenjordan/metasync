const logger = require('./logger');
/**
 * Product Base Handler
 *
 * Handles core product operations in Shopify, including:
 * - Product creation
 * - Product updating
 * - Product deletion
 * - Fetching products by ID or handle
 */
;

class ProductBaseHandler {
  constructor(client, options = {}) {
    this.client = client;
    this.options = options;
    this.debug = options.debug;
  }

  /**
   * Create a new product
   * @param {Object} productInput - Product creation input
   * @param {string} logPrefix - Prefix for logs
   * @returns {Promise<Object|null>} - Created product or null if failed
   */
  async createProduct(productInput, logPrefix = '') {
    const mutation = `#graphql
      mutation createProduct($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
            title
            handle
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
        logger.info(`Creating base product "${productInput.title}"`, 2, 'main');
        const result = await this.client.graphql(mutation, { input: productInput }, 'CreateProduct');

        if (result.productCreate.userErrors.length > 0) {
          logger.error(`Failed to create product "${productInput.title}"`, 2, result.productCreate.userErrors);
          return null;
        }

        const newProduct = result.productCreate.product;
        logger.success(`Base product created successfully`, 2);
        return newProduct;
      } catch (error) {
        logger.error(`Error creating product "${productInput.title}": ${error.message}`, 2);
        return null;
      }
    } else {
      logger.info(`[DRY RUN] Would create product "${productInput.title}"`, 2, 'main');
      return { id: "dry-run-id", title: productInput.title, handle: productInput.handle };
    }
  }

  /**
   * Update an existing product
   * @param {string} productId - ID of the product to update
   * @param {Object} productInput - Product update input
   * @param {string} logPrefix - Prefix for logs
   * @returns {Promise<Object|null>} - Updated product or null if failed
   */
  async updateProduct(productId, productInput, logPrefix = '') {
    const updateInput = {
      ...productInput,
      id: productId
    };

    const mutation = `#graphql
      mutation ProductUpdate($productUpdateInput: ProductUpdateInput!) {
        productUpdate(product: $productUpdateInput) {
          product {
            id
            title
            handle
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
        logger.info(`Updating base product data`, 2, 'main');
        const result = await this.client.graphql(
          mutation,
          { productUpdateInput: updateInput },
          'ProductUpdate'
        );

        if (result.productUpdate.userErrors.length > 0) {
          logger.error(`Failed to update product "${productInput.title}"`, 2, result.productUpdate.userErrors);
          return null;
        }

        const updatedProduct = result.productUpdate.product;
        logger.success(`Base product data updated successfully`, 3);
        return updatedProduct;
      } catch (error) {
        logger.error(`Error updating product: ${error.message}`, 2);
        return null;
      }
    } else {
      logger.info(`[DRY RUN] Would update product "${productInput.title}"`, 2, 'main');
      return { id: productId, title: productInput.title, handle: productInput.handle };
    }
  }

  /**
   * Delete a product
   * @param {string} productId - ID of the product to delete
   * @param {string} logPrefix - Prefix for logs
   * @returns {Promise<boolean>} - Success status
   */
  async deleteProduct(productId, logPrefix = '') {
    if (!productId) {
      logger.error(`Cannot delete product: No product ID provided`, 2);
      return false;
    }

    const mutation = `#graphql
      mutation productDelete($input: ProductDeleteInput!) {
        productDelete(input: $input) {
          deletedProductId
          userErrors {
            field
            message
          }
        }
      }
    `;

    if (this.options.notADrill) {
      try {
        logger.info(`Deleting product with ID: ${productId}`, 2, 'main');
        const result = await this.client.graphql(mutation, {
          input: {
            id: productId
          }
        }, 'ProductDelete');

        if (result.productDelete.userErrors.length > 0) {
          logger.error(`Failed to delete product`, 2, result.productDelete.userErrors);
          return false;
        }

        logger.success(`Product deleted successfully`, 2);
        return true;
      } catch (error) {
        logger.error(`Error deleting product: ${error.message}`, 2);
        return false;
      }
    } else {
      logger.info(`[DRY RUN] Would delete product with ID: ${productId}`, 2, 'main');
      return true;
    }
  }

  /**
   * Get a product by handle
   * @param {string} handle - Product handle
   * @returns {Promise<Object|null>} - Product or null if not found
   */
  async getProductByHandle(handle) {
    if (!handle) return null;

    const query = `#graphql
      query GetProductByHandle($handle: String!) {
        productByHandle(handle: $handle) {
          id
          title
          handle
          status
        }
      }
    `;

    try {
      const response = await this.client.graphql(query, { handle }, 'GetProductByHandle');
      return response.productByHandle;
    } catch (error) {
      logger.error(`Error fetching product by handle: ${error.message}`, 1);
      return null;
    }
  }
}

module.exports = ProductBaseHandler;
