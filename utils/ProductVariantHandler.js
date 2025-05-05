/**
 * Product Variant Handler
 *
 * Handles product variant operations in Shopify, including:
 * - Variant creation
 * - Variant updates
 * - Variant image association
 * - Variant metafield management
 */
const consola = require('consola');
const LoggingUtils = require('./LoggingUtils');

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
    LoggingUtils.info(`Preparing to update variants for product ID: ${productId}`, 1, 'main');

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

      LoggingUtils.info(`Found ${targetVariants.length} existing variants in target product`, 2);
      LoggingUtils.info(`Found ${targetImages.length} existing images in target product`, 2);

    } catch (error) {
      LoggingUtils.error(`Error fetching target product variants: ${error.message}`, 2);
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
      LoggingUtils.info(`Uploading ${variantImagesToUpload.length} variant images`, 2);
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

        LoggingUtils.success(`Successfully refreshed image IDs after upload`, 2);
      } catch (error) {
        LoggingUtils.error(`Error refreshing images: ${error.message}`, 2);
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
        LoggingUtils.info(`Preparing to create new variant with options: ${optionKey}`, 2);

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
          sourceImage: sourceVariant.image // Store image to apply after creation
        };

        // Add inventory item data if available
        if (sourceVariant.inventoryItem) {
          createInput.inventoryItem = {};

          // Add sku to inventoryItem
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

    // Results tracking
    let updateSuccess = true;
    let createSuccess = true;

    // STEP 1: Update existing variants
    if (variantsToUpdate.length > 0) {
      LoggingUtils.info(`Updating ${variantsToUpdate.length} existing variants for product ID: ${productId}`, 2);

      const updateVariantsMutation = `#graphql
        mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants {
              id
              title
              inventoryItem {
                sku
              }
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
          const result = await this.client.graphql(updateVariantsMutation, {
            productId,
            variants: variantsToUpdate
          }, 'ProductVariantsBulkUpdate');

          if (result.productVariantsBulkUpdate.userErrors.length > 0) {
            LoggingUtils.error(`Failed to update variants:`, 3, result.productVariantsBulkUpdate.userErrors);
            updateSuccess = false;
          } else {
            LoggingUtils.success(`Successfully updated ${result.productVariantsBulkUpdate.productVariants.length} variants`, 3);

            // Update the variant images separately since imageId isn't supported in bulk updates
            if (imageUpdates.length > 0) {
              LoggingUtils.info(`Updating images for ${imageUpdates.length} variants`, 3);

              for (const update of imageUpdates) {
                if (this.imageHandler) {
                  await this.updateVariantImage(update.variantId, update.imageId, productId);
                } else {
                  LoggingUtils.info(`Would update image for variant ${update.variantId}`, 4);
                }
              }
            }

            // Now update metafields for each variant
            for (const metafieldUpdate of metafieldUpdates) {
              if (this.metafieldHandler) {
                LoggingUtils.info(`Syncing ${metafieldUpdate.metafields.length} metafields for variant ${metafieldUpdate.targetVariantId}`, 3);
                await this.metafieldHandler.syncMetafields(
                  metafieldUpdate.targetVariantId,
                  metafieldUpdate.metafields
                );
              } else {
                LoggingUtils.info(`Would update ${metafieldUpdate.metafields.length} metafields for variant ${metafieldUpdate.targetVariantId}`, 4);
              }
            }
          }
        } catch (error) {
          LoggingUtils.error(`Error updating variants: ${error.message}`, 3);
          updateSuccess = false;
        }
      } else {
        LoggingUtils.info(`[DRY RUN] Would update ${variantsToUpdate.length} variants for product ID: ${productId}`, 3);

        if (imageUpdates.length > 0) {
          LoggingUtils.info(`[DRY RUN] Would update images for ${imageUpdates.length} variants`, 4);
        }

        // Log metafield updates
        for (const metafieldUpdate of metafieldUpdates) {
          LoggingUtils.info(`[DRY RUN] Would update ${metafieldUpdate.metafields.length} metafields for variant ID: ${metafieldUpdate.targetVariantId}`, 4);
        }
      }
    } else {
      LoggingUtils.info(`No existing variants to update`, 2);
    }

    // STEP 2: Create new variants that don't exist in target
    if (variantsToCreate.length > 0) {
      LoggingUtils.info(`Creating ${variantsToCreate.length} new variants for product ID: ${productId}`, 2);

      // Remove the sourceMetafields and sourceImage from the input as it's not part of the API
      const createInputs = variantsToCreate.map(({ sourceMetafields, sourceImage, ...rest }) => rest);

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
            LoggingUtils.error(`Failed to create new variants:`, 3, result.productVariantsBulkCreate.userErrors);
            createSuccess = false;
          } else {
            LoggingUtils.success(`Successfully created ${result.productVariantsBulkCreate.productVariants.length} new variants`, 3);

            // Now handle metafields and images for each created variant
            for (let i = 0; i < result.productVariantsBulkCreate.productVariants.length; i++) {
              const createdVariant = result.productVariantsBulkCreate.productVariants[i];
              const sourceMetafields = variantsToCreate[i].sourceMetafields;
              const sourceImage = variantsToCreate[i].sourceImage;

              // Handle metafields
              if (sourceMetafields && sourceMetafields.length > 0 && this.metafieldHandler) {
                LoggingUtils.info(`Syncing ${sourceMetafields.length} metafields for new variant ${createdVariant.id}`, 4);
                await this.metafieldHandler.syncMetafields(
                  createdVariant.id,
                  sourceMetafields
                );
              } else if (sourceMetafields && sourceMetafields.length > 0) {
                LoggingUtils.info(`Would sync ${sourceMetafields.length} metafields for new variant ${createdVariant.id}`, 4);
              }

              // Handle image
              if (sourceImage && sourceImage.src) {
                const sourceFilename = sourceImage.src.split('/').pop().split('?')[0];
                if (imageIdMap[sourceFilename]) {
                  if (this.imageHandler) {
                    await this.updateVariantImage(createdVariant.id, imageIdMap[sourceFilename], productId);
                  } else {
                    LoggingUtils.info(`Would assign image to new variant ${createdVariant.id}`, 4);
                  }
                }
              }
            }
          }
        } catch (error) {
          LoggingUtils.error(`Error creating new variants: ${error.message}`, 3);
          createSuccess = false;
        }
      } else {
        LoggingUtils.info(`[DRY RUN] Would create ${variantsToCreate.length} new variants for product ID: ${productId}`, 3);

        // Log variant image and metafield creation info
        for (let i = 0; i < variantsToCreate.length; i++) {
          if (variantsToCreate[i].sourceImage) {
            LoggingUtils.info(`[DRY RUN] New variant #${i + 1} would have an image assigned`, 4);
          }

          const sourceMetafields = variantsToCreate[i].sourceMetafields;
          if (sourceMetafields && sourceMetafields.length > 0) {
            LoggingUtils.info(`[DRY RUN] Would create ${sourceMetafields.length} metafields for new variant #${i + 1}`, 4);
          }
        }
      }
    } else {
      LoggingUtils.info(`No new variants to create`, 2);
    }

    // Return overall success status
    return updateSuccess && createSuccess;
  }

  /**
   * Create variants for a product
   * @param {string} productId - The product ID
   * @param {Array} variants - Array of variant objects to create
   * @param {string} logPrefix - Prefix for logs
   * @returns {Promise<boolean>} - Success status
   */
  async createProductVariants(productId, variants, logPrefix = '') {
    LoggingUtils.info(`Creating ${variants.length} variants for product ID: ${productId}`, 1, 'main');

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
      LoggingUtils.warn(`Found ${duplicates.length} duplicate option combinations:`, 2);
      duplicates.forEach(dup => LoggingUtils.warn(`${dup}`, 3));
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
            LoggingUtils.error(`Failed to create variants:`, 2, nonExistingVariantErrors);

            // Log created variants even if there were some errors
            if (result.productVariantsBulkCreate.productVariants.length > 0) {
              LoggingUtils.info(`Successfully created ${result.productVariantsBulkCreate.productVariants.length} variants despite errors`, 2);
            }

            // Return false if no variants were created
            if (result.productVariantsBulkCreate.productVariants.length === 0) {
              return false;
            }
          }
        }

        LoggingUtils.success(`Successfully created ${result.productVariantsBulkCreate.productVariants.length} variants`, 2);
        return true;
      } catch (error) {
        LoggingUtils.error(`Error creating variants: ${error.message}`, 2);
        return false;
      }
    } else {
      LoggingUtils.info(`[DRY RUN] Would create ${variantsInput.length} variants for product`, 2);
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
        LoggingUtils.info(`Updating image for variant ID: ${variantId}`, 2);
        const result = await this.client.graphql(mutation, {
          input: {
            id: variantId,
            imageId: imageId
          }
        }, 'ProductVariantUpdate');

        if (result.productVariantUpdate.userErrors.length > 0) {
          LoggingUtils.error(`Failed to update variant image:`, 3, result.productVariantUpdate.userErrors);
          return false;
        } else {
          LoggingUtils.success(`Successfully updated variant image`, 3);
          return true;
        }
      } catch (error) {
        LoggingUtils.error(`Error updating variant image: ${error.message}`, 2);
        return false;
      }
    } else {
      LoggingUtils.info(`[DRY RUN] Would update image for variant ID: ${variantId}`, 2);
      return true;
    }
  }
}

module.exports = ProductVariantHandler;
