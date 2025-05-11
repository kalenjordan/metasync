/**
 * Product Variant Handler
 *
 * Handles product variant operations in Shopify, including:
 * - Variant creation
 * - Variant updates
 * - Variant image association
 * - Variant metafield management
 */
;
const logger = require('./logger');

class ProductVariantHandler {
  constructor(client, options = {}, dependencies = {}) {
    this.client = client;
    this.options = options;
    this.debug = options.debug;

    // Store dependencies like metafieldHandler
    this.metafieldHandler = dependencies.metafieldHandler;
    this.imageHandler = dependencies.imageHandler;
  }

  /**
   * Update variants for a product - either update existing ones or create new ones
   * @param {string} productId - The product ID
   * @param {Array} sourceVariants - Array of variant objects from source product
   * @param {string} logPrefix - Prefix for logs
   * @returns {Promise<boolean>} - Success status
   */
  async updateProductVariants(productId, sourceVariants, logPrefix = '') {
    logger.info(`Preparing to update variants for product ID: ${productId}`, 'main');

    // Indent all variant operations
    logger.indent();

    // First, fetch current variants from the target product to get their IDs
    const targetVariantsQuery = `#graphql
      query GetProductVariants($productId: ID!) {
        product(id: $productId) {
          variants(first: 100) {
            edges {
              node {
                id
                selectedOptions {
                  name
                  value
                }
                sku
                price
                compareAtPrice
                inventoryQuantity
                inventoryPolicy
                inventoryItem {
                  id
                  sku
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
                image {
                  id
                  src
                }
              }
            }
          }
          images(first: 50) {
            edges {
              node {
                id
                src
              }
            }
          }
        }
      }
    `;

    let targetVariants = [];
    let targetImages = [];

    try {
      const response = await this.client.graphql(
        targetVariantsQuery,
        { productId },
        'GetProductVariants'
      );

      // Extract the variants from the response
      targetVariants = response.product.variants.edges.map(edge => edge.node);
      targetImages = response.product.images.edges.map(edge => edge.node);

      logger.info(`Found ${targetVariants.length} existing variants in target product`);
      logger.info(`Found ${targetImages.length} existing images in target product`);

    } catch (error) {
      logger.error(`Error fetching target product variants: ${error.message}`);
      logger.unindent(); // Unindent before returning on error
      return false;
    }

    // Create a lookup map for target variants by their option combination
    const targetVariantMap = {};
    targetVariants.forEach(variant => {
      // Create a key from the variant's option values
      const optionKey = variant.selectedOptions
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(opt => `${opt.name}:${opt.value}`)
        .join('|');

      targetVariantMap[optionKey] = variant;
    });

    // Create a map of image ids by src filename
    let imageIdMap = {};
    targetImages.forEach(img => {
      const filename = img.src.split('/').pop().split('?')[0];
      imageIdMap[filename] = img.id;
    });

    // Collect variant images that need to be uploaded
    const variantImagesToUpload = [];

    for (const sourceVariant of sourceVariants) {
      if (sourceVariant.image && sourceVariant.image.src) {
        const sourceFilename = sourceVariant.image.src.split('/').pop().split('?')[0];

        // Check if this image already exists in the target product
        if (!imageIdMap[sourceFilename]) {
          const alreadyAdded = variantImagesToUpload.some(img =>
            img.src === sourceVariant.image.src
          );

          if (!alreadyAdded) {
            variantImagesToUpload.push({
              src: sourceVariant.image.src,
              altText: sourceVariant.image.altText || ''
            });
          }
        }
      }
    }

    // Upload new variant images if needed
    if (variantImagesToUpload.length > 0 && this.imageHandler && this.options.notADrill) {
      logger.info(`Uploading ${variantImagesToUpload.length} variant images`);
      await this.imageHandler.syncProductImages(productId, variantImagesToUpload);

      // Refresh image IDs after upload
      try {
        const imagesQuery = `#graphql
          query getProductImages($productId: ID!) {
            product(id: $productId) {
              images(first: 50) {
                edges {
                  node {
                    id
                    src
                  }
                }
              }
            }
          }
        `;

        const response = await this.client.graphql(imagesQuery, { productId }, 'GetProductImages');
        targetImages = response.product.images.edges.map(edge => edge.node);

        // Update the image ID map
        imageIdMap = {};
        targetImages.forEach(img => {
          const filename = img.src.split('/').pop().split('?')[0];
          imageIdMap[filename] = img.id;
        });

        logger.success(`Successfully refreshed image IDs after upload`);
      } catch (error) {
        logger.error(`Error refreshing images: ${error.message}`);
      }
    }

    // Match source variants to target variants and prepare the update inputs
    const variantsToUpdate = [];
    const variantsToCreate = [];
    const metafieldUpdates = []; // Track which variants need metafield updates
    const imageUpdates = []; // Track which variants need image updates

    for (const sourceVariant of sourceVariants) {
      // Create the same key format for source variant
      const optionKey = sourceVariant.selectedOptions
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(opt => `${opt.name}:${opt.value}`)
        .join('|');

      const targetVariant = targetVariantMap[optionKey];

      if (targetVariant) {
        // Found a matching variant in the target product - UPDATE
        const variantInput = {
          id: targetVariant.id, // Use the target shop's variant ID
          price: sourceVariant.price,
          compareAtPrice: sourceVariant.compareAtPrice,
          barcode: sourceVariant.barcode,
          taxable: sourceVariant.taxable,
          inventoryPolicy: sourceVariant.inventoryPolicy
        };

        // Add inventory item data if available
        if (sourceVariant.inventoryItem) {
          variantInput.inventoryItem = {};

          // Add sku to inventoryItem
          if (sourceVariant.sku) {
            variantInput.inventoryItem.sku = sourceVariant.sku;
          }

          // Add requiresShipping if available
          if (sourceVariant.inventoryItem.requiresShipping !== undefined) {
            variantInput.inventoryItem.requiresShipping = sourceVariant.inventoryItem.requiresShipping;
          }

          // Add weight if available
          if (sourceVariant.inventoryItem.measurement && sourceVariant.inventoryItem.measurement.weight) {
            variantInput.inventoryItem.measurement = {
              weight: {
                value: sourceVariant.inventoryItem.measurement.weight.value,
                unit: sourceVariant.inventoryItem.measurement.weight.unit
              }
            };
          }
        } else if (sourceVariant.sku) {
          // If inventoryItem not present but SKU is, create the inventoryItem
          variantInput.inventoryItem = {
            sku: sourceVariant.sku
          };
        }

        variantsToUpdate.push(variantInput);

        // Track metafield updates if the variant has metafields
        if (sourceVariant.metafields && sourceVariant.metafields.length > 0) {
          metafieldUpdates.push({
            targetVariantId: targetVariant.id,
            metafields: sourceVariant.metafields
          });
        }

        // For image updates, we need to do them separately since imageId doesn't work in bulk update
        if (sourceVariant.image && sourceVariant.image.src) {
          const sourceFilename = sourceVariant.image.src.split('/').pop().split('?')[0];
          if (imageIdMap[sourceFilename]) {
            imageUpdates.push({
              variantId: targetVariant.id,
              imageId: imageIdMap[sourceFilename]
            });
          }
        }
      } else {
        // Variant doesn't exist in target - CREATE instead of just warning
        logger.info(`Preparing to create new variant with options: ${optionKey}`, 3);

        // Format for productVariantsBulkCreate
        const createInput = {
          price: sourceVariant.price,
          compareAtPrice: sourceVariant.compareAtPrice,
          barcode: sourceVariant.barcode,
          taxable: sourceVariant.taxable,
          inventoryPolicy: sourceVariant.inventoryPolicy,
          optionValues: sourceVariant.selectedOptions.map(option => ({
            name: option.value,
            optionName: option.name
          })),
          sourceMetafields: sourceVariant.metafields, // Store metafields to apply after creation
          sourceImage: sourceVariant.image, // Store image to apply after creation
          sourceOptions: sourceVariant.selectedOptions // Store options for reference matching later
        };

        // Add inventory item data if available
        if (sourceVariant.inventoryItem) {
          createInput.inventoryItem = {};

          // Add sku to inventoryItem if available
          if (sourceVariant.sku) {
            createInput.inventoryItem.sku = sourceVariant.sku;
          }

          // Add requiresShipping if available
          if (sourceVariant.inventoryItem.requiresShipping !== undefined) {
            createInput.inventoryItem.requiresShipping = sourceVariant.inventoryItem.requiresShipping;
          }

          // Add weight if available
          if (sourceVariant.inventoryItem.measurement && sourceVariant.inventoryItem.measurement.weight) {
            createInput.inventoryItem.measurement = {
              weight: {
                value: sourceVariant.inventoryItem.measurement.weight.value,
                unit: sourceVariant.inventoryItem.measurement.weight.unit
              }
            };
          }
        } else if (sourceVariant.sku) {
          // If inventoryItem not present but SKU is, create the inventoryItem
          createInput.inventoryItem = {
            sku: sourceVariant.sku
          };
        }

        variantsToCreate.push(createInput);
      }
    }

    // Handle creating/updating variants - perform these operations in two phases
    let updateSuccess = true;
    let createSuccess = true;

    // Update existing variants if any
    if (variantsToUpdate.length > 0) {
      updateSuccess = await this._updateExistingVariants(productId, variantsToUpdate, metafieldUpdates, imageUpdates);
    } else {
      logger.info(`No existing variants to update`);
    }

    // Create new variants if any
    if (variantsToCreate.length > 0) {
      createSuccess = await this._createNewVariants(productId, variantsToCreate);
    } else {
      logger.info(`No new variants to create`);
    }

    // Unindent after all operations
    logger.unindent();

    // Return overall success status
    return updateSuccess && createSuccess;
  }

  /**
   * Update existing variants in bulk
   * @private
   */
  async _updateExistingVariants(productId, variantsToUpdate, metafieldUpdates, imageUpdates) {
    logger.info(`Updating ${variantsToUpdate.length} existing variants for product ID: ${productId}`);

    // Indent for variant update operations
    logger.indent();

    const updateMutation = `#graphql
      mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants {
            id
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
        const result = await this.client.graphql(
          updateMutation,
          {
            productId,
            variants: variantsToUpdate.map(v => ({
              id: v.id,
              price: v.price,
              compareAtPrice: v.compareAtPrice,
              barcode: v.barcode,
              taxable: v.taxable,
              inventoryPolicy: v.inventoryPolicy,
              inventoryItem: v.inventoryItem
            }))
          },
          'ProductVariantsBulkUpdate'
        );

        if (result.productVariantsBulkUpdate.userErrors.length > 0) {
          logger.error(`Failed to update variants:`, result.productVariantsBulkUpdate.userErrors);
          logger.unindent();
          return false;
        }

        logger.success(`Successfully updated ${result.productVariantsBulkUpdate.productVariants.length} variants`);

        // Handle variant image updates
        if (imageUpdates.length > 0) {
          logger.info(`Updating images for ${imageUpdates.length} variants`);

          // Indent for image operations
          logger.indent();

          for (const update of imageUpdates) {
            if (this.options.notADrill) {
              await this.updateVariantImage(update.variantId, update.imageId, productId);
            } else {
              logger.info(`Would update image for variant ${update.variantId}`);
            }
          }

          // Unindent after image operations
          logger.unindent();
        }

        // Sync metafields for each variant
        for (const metafieldUpdate of metafieldUpdates) {
          if (metafieldUpdate.sourceMetafields.length > 0) {
            logger.info(`Syncing ${metafieldUpdate.sourceMetafields.length} metafields for variant ${metafieldUpdate.targetVariantId}`);

            if (this.options.notADrill) {
              await this.metafieldHandler.syncMetafields(
                metafieldUpdate.targetVariantId,
                metafieldUpdate.sourceMetafields
              );
            } else {
              logger.info(`Would update ${metafieldUpdate.sourceMetafields.length} metafields for variant ${metafieldUpdate.targetVariantId}`);
            }
          }
        }

        // Unindent after all variant operations
        logger.unindent();
        return true;
      } catch (error) {
        logger.error(`Error updating variants: ${error.message}`);
        logger.unindent();
        return false;
      }
    } else {
      logger.info(`[DRY RUN] Would update ${variantsToUpdate.length} variants for product ID: ${productId}`);

      // Indent for dry run details
      logger.indent();

      if (imageUpdates.length > 0) {
        logger.info(`[DRY RUN] Would update images for ${imageUpdates.length} variants`);
      }

      for (const metafieldUpdate of metafieldUpdates) {
        if (metafieldUpdate.sourceMetafields.length > 0) {
          logger.info(`[DRY RUN] Would update ${metafieldUpdate.sourceMetafields.length} metafields for variant ID: ${metafieldUpdate.targetVariantId}`);
        }
      }

      // Unindent after dry run details
      logger.unindent();

      // Unindent after variant operations
      logger.unindent();

      return true;
    }
  }

  /**
   * Create new variants in bulk
   * @private
   */
  async _createNewVariants(productId, variantsToCreate) {
    logger.info(`Creating ${variantsToCreate.length} new variants for product ID: ${productId}`);

    // Indent for variant creation operations
    logger.indent();

    // Remove the sourceMetafields, sourceImage, and sourceOptions from the input as they're not part of the API
    const createInputs = variantsToCreate.map(({ sourceMetafields, sourceImage, sourceOptions, ...rest }) => rest);

    const createVariantsMutation = `#graphql
      mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkCreate(productId: $productId, variants: $variants) {
          productVariants {
            id
            title
            inventoryItem {
              sku
            }
            selectedOptions {
              name
              value
            }
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    if (this.options.notADrill) {
      try {
        const result = await this.client.graphql(createVariantsMutation, {
          productId,
          variants: createInputs
        }, 'ProductVariantsBulkCreate');

        if (result.productVariantsBulkCreate.userErrors.length > 0) {
          // Filter out "variant already exists" errors which we handle specially
          const nonExistingVariantErrors = result.productVariantsBulkCreate.userErrors.filter(
            err => err.code !== 'VARIANT_ALREADY_EXISTS'
          );

          if (nonExistingVariantErrors.length > 0) {
            logger.error(`Failed to create new variants:`, 3, nonExistingVariantErrors);

            // Log created variants even if there were some errors
            if (result.productVariantsBulkCreate.productVariants.length > 0) {
              logger.info(`Successfully created ${result.productVariantsBulkCreate.productVariants.length} variants despite errors`, 2);
            }

            // Return false if no variants were created
            if (result.productVariantsBulkCreate.productVariants.length === 0) {
              return false;
            }
          }
        }

        logger.success(`Successfully created ${result.productVariantsBulkCreate.productVariants.length} variants`, 1);
        return true;
      } catch (error) {
        logger.error(`Error creating new variants: ${error.message}`, 3);
        return false;
      }
    } else {
      logger.info(`[DRY RUN] Would create ${createInputs.length} new variants for product`, 2);
      return true;
    }
  }

  /**
   * Find the index of a variant in the created variants array by matching option values
   * @param {Array} variants - Array of created variants
   * @param {Array} sourceOptions - Source variant option values to match
   * @returns {Number} - Index of the matching variant or -1 if not found
   */
  findMatchingVariantIndex(variants, sourceOptions) {
    if (!variants || !variants.length || !sourceOptions || !sourceOptions.length) {
      return -1;
    }

    // Create a normalized key for the source options
    const sourceKey = sourceOptions
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(opt => `${opt.name}:${opt.value}`)
      .join('|');

    // Find the index of the variant with matching options
    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      if (variant.selectedOptions) {
        const variantKey = variant.selectedOptions
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(opt => `${opt.name}:${opt.value}`)
          .join('|');

        if (variantKey === sourceKey) {
          return i;
        }
      }
    }

    return -1;
  }

  /**
   * Create variants for a product
   * @param {string} productId - The product ID
   * @param {Array} variants - Array of variant objects to create
   * @param {string} logPrefix - Prefix for logs
   * @returns {Promise<boolean>} - Success status
   */
  async createProductVariants(productId, variants, logPrefix = '') {
    logger.info(`Creating ${variants.length} variants for product ID: ${productId}`, 1, 'main');

    // First check if we have valid option combinations - set to track unique combinations
    const optionCombinations = new Set();
    const duplicates = [];

    variants.forEach(variant => {
      // Create a key from the variant's option values to detect duplicates
      const optionKey = variant.selectedOptions
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(opt => `${opt.name}:${opt.value}`)
        .join('|');

      if (optionCombinations.has(optionKey)) {
        duplicates.push(optionKey);
      } else {
        optionCombinations.add(optionKey);
      }
    });

    // Log if duplicates are found
    if (duplicates.length > 0) {
      logger.warn(`Found ${duplicates.length} duplicate option combinations:`, 2);
      duplicates.forEach(dup => logger.warn(`${dup}`, 3));
    }

    // Transform variants to the format expected by productVariantsBulkCreate
    const variantsInput = variants.map(variant => {
      const variantInput = {
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        barcode: variant.barcode,
        taxable: variant.taxable,
        inventoryPolicy: variant.inventoryPolicy,
        optionValues: variant.selectedOptions.map(option => ({
          name: option.value,
          optionName: option.name
        }))
      };

      // Add inventory item data if available
      if (variant.inventoryItem) {
        variantInput.inventoryItem = {};

        // Add sku to inventoryItem (not directly on variant)
        if (variant.sku) {
          variantInput.inventoryItem.sku = variant.sku;
        }

        // Add requiresShipping if available
        if (variant.inventoryItem.requiresShipping !== undefined) {
          variantInput.inventoryItem.requiresShipping = variant.inventoryItem.requiresShipping;
        }

        // Add weight if available
        if (variant.inventoryItem.measurement && variant.inventoryItem.measurement.weight) {
          variantInput.inventoryItem.measurement = {
            weight: {
              value: variant.inventoryItem.measurement.weight.value,
              unit: variant.inventoryItem.measurement.weight.unit
            }
          };
        }
      } else if (variant.sku) {
        // If inventoryItem not present but SKU is, create the inventoryItem
        variantInput.inventoryItem = {
          sku: variant.sku
        };
      }

      return variantInput;
    });

    const createVariantsMutation = `#graphql
      mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkCreate(productId: $productId, variants: $variants) {
          productVariants {
            id
            title
            inventoryItem {
              sku
            }
            selectedOptions {
              name
              value
            }
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    if (this.options.notADrill) {
      try {
        const result = await this.client.graphql(createVariantsMutation, {
          productId,
          variants: variantsInput
        }, 'ProductVariantsBulkCreate');

        if (result.productVariantsBulkCreate.userErrors.length > 0) {
          // Filter out "variant already exists" errors which we handle specially
          const nonExistingVariantErrors = result.productVariantsBulkCreate.userErrors.filter(
            err => err.code !== 'VARIANT_ALREADY_EXISTS'
          );

          if (nonExistingVariantErrors.length > 0) {
            logger.error(`Failed to create variants:`, 2, nonExistingVariantErrors);

            // Log created variants even if there were some errors
            if (result.productVariantsBulkCreate.productVariants.length > 0) {
              logger.info(`Successfully created ${result.productVariantsBulkCreate.productVariants.length} variants despite errors`, 2);
            }

            // Return false if no variants were created
            if (result.productVariantsBulkCreate.productVariants.length === 0) {
              return false;
            }
          }
        }

        logger.success(`Successfully created ${result.productVariantsBulkCreate.productVariants.length} variants`, 1);
        return true;
      } catch (error) {
        logger.error(`Error creating variants: ${error.message}`, 2);
        return false;
      }
    } else {
      logger.info(`[DRY RUN] Would create ${variantsInput.length} variants for product`, 2);
      return true;
    }
  }

  /**
   * Helper method to find matching variant by option values
   * @param {Array} variants - Array of variants
   * @param {Array} targetOptions - Target option values to match
   * @returns {Object} - Matching variant or undefined
   */
  findMatchingVariantByOptions(variants, targetOptions) {
    // Create a normalized key for the target options
    const targetKey = targetOptions
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(opt => `${opt.name}:${opt.value}`)
      .join('|');

    // Find the variant with matching options
    return variants.find(variant => {
      const variantKey = variant.selectedOptions
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(opt => `${opt.name}:${opt.value}`)
        .join('|');

      return variantKey === targetKey;
    });
  }

  /**
   * Update a variant's image
   * @param {string} variantId - The variant ID
   * @param {string} imageId - The image ID
   * @param {string} productId - The product ID
   * @param {string} logPrefix - Prefix for logs
   * @returns {Promise<boolean>} - Success status
   */
  async updateVariantImage(variantId, imageId, productId, logPrefix = '') {
    if (this.imageHandler) {
      return await this.imageHandler.updateVariantImage(variantId, imageId, productId);
    }

    const mutation = `#graphql
      mutation productVariantUpdate($input: ProductVariantInput!) {
        productVariantUpdate(input: $input) {
          productVariant {
            id
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
        logger.info(`Updating image for variant ID: ${variantId}`, 2);
        const result = await this.client.graphql(mutation, {
          input: {
            id: variantId,
            imageId: imageId
          }
        }, 'ProductVariantUpdate');

        if (result.productVariantUpdate.userErrors.length > 0) {
          logger.error(`Failed to update variant image:`, 3, result.productVariantUpdate.userErrors);
          return false;
        } else {
          logger.success(`Successfully updated variant image`, 3);
          return true;
        }
      } catch (error) {
        logger.error(`Error updating variant image: ${error.message}`, 2);
        return false;
      }
    } else {
      logger.info(`[DRY RUN] Would update image for variant ID: ${variantId}`, 2);
      return true;
    }
  }

  /**
   * Get a variant by its ID from any store
   * @param {Object} client - Shopify client to use
   * @param {String} variantId - The variant ID to retrieve
   * @returns {Promise<Object|null>} - The variant object or null if not found
   */
  async getVariantById(client, variantId) {
    const query = `#graphql
      query GetVariantById($variantId: ID!) {
        productVariant(id: $variantId) {
          id
          sku
          title
          product {
            id
            title
            handle
          }
        }
      }
    `;

    try {
      const response = await client.graphql(query, { variantId }, 'GetVariantById');
      return response.productVariant;
    } catch (error) {
      logger.error(`Error fetching variant by ID ${variantId}: ${error.message}`, 4);
      return null;
    }
  }

  /**
   * Get a variant by its SKU in the target store
   * @param {Object} client - Shopify client to use
   * @param {String} sku - The SKU to search for
   * @returns {Promise<Object|null>} - The variant object or null if not found
   */
  async getVariantBySku(client, sku) {
    const query = `#graphql
      query GetVariantBySku($query: String!) {
        productVariants(first: 1, query: $query) {
          edges {
            node {
              id
              sku
              title
              product {
                id
                title
                handle
              }
            }
          }
        }
      }
    `;

    try {
      // Use a query that filters variants by SKU
      const response = await client.graphql(query, { query: `sku:${sku}` }, 'GetVariantBySku');

      if (response.productVariants.edges.length === 0) {
        logger.info(`No variant found with SKU: ${sku}`, 4);
        return null;
      }

      return response.productVariants.edges[0].node;
    } catch (error) {
      logger.error(`Error fetching variant by SKU ${sku}: ${error.message}`, 4);
      return null;
    }
  }

  /**
   * Get a variant by its product handle and option values when SKU matching isn't possible
   * @param {Object} client - Shopify client to use
   * @param {String} productHandle - The product handle
   * @param {Array} optionValues - Array of {name, value} option pairs
   * @returns {Promise<Object|null>} - The variant object or null if not found
   */
  async getVariantByOptions(client, productHandle, optionValues) {
    const query = `#graphql
      query GetProductByHandle($handle: String!) {
        productByHandle(handle: $handle) {
          id
          title
          handle
          variants(first: 100) {
            edges {
              node {
                id
                sku
                title
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response = await client.graphql(query, { handle: productHandle }, 'GetProductByHandle');

      if (!response.productByHandle) {
        logger.error(`No product found with handle: ${productHandle}`, 4);
        return null;
      }

      // Get all variants from the product
      const variants = response.productByHandle.variants.edges.map(edge => edge.node);

      if (variants.length === 0) {
        logger.error(`No variants found for product: ${productHandle}`, 4);
        return null;
      }

      // Create a normalized key for target option values for matching
      const targetKey = optionValues
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(opt => `${opt.name}:${opt.value}`)
        .join('|');

      // Find matching variant
      const matchingVariant = variants.find(variant => {
        const variantKey = variant.selectedOptions
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(opt => `${opt.name}:${opt.value}`)
          .join('|');

        return variantKey === targetKey;
      });

      if (!matchingVariant) {
        logger.error(`No variant found with options ${targetKey} for product: ${productHandle}`, 4);
        return null;
      }

      return matchingVariant;
    } catch (error) {
      logger.error(`Error finding variant by options for product ${productHandle}: ${error.message}`, 4);
      return null;
    }
  }

  /**
   * Get full details of a variant including its product and options
   * @param {Object} client - Shopify client to use
   * @param {String} variantId - The variant ID to retrieve
   * @returns {Promise<Object|null>} - The variant object with product and options, or null if not found
   */
  async getVariantWithProductInfo(client, variantId) {
    const query = `#graphql
      query GetVariantWithProduct($variantId: ID!) {
        productVariant(id: $variantId) {
          id
          sku
          title
          selectedOptions {
            name
            value
          }
          product {
            id
            title
            handle
          }
        }
      }
    `;

    try {
      const response = await client.graphql(query, { variantId }, 'GetVariantWithProduct');
      return response.productVariant;
    } catch (error) {
      logger.error(`Error fetching variant with product info for ID ${variantId}: ${error.message}`, 4);
      return null;
    }
  }
}

module.exports = ProductVariantHandler;
