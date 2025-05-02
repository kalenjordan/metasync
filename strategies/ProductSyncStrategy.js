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
 */
const consola = require('consola');
const { SHOPIFY_API_VERSION } = require('../constants');

class ProductSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.debug = options.debug;
  }

  // --- Product Methods ---

  async fetchProducts(client, limit = 50) {
    const query = `#graphql
      query GetProducts($first: Int!) {
        products(first: $first) {
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

    try {
      const response = await client.graphql(query, { first: limit }, 'GetProducts');
      return response.products.edges.map(edge => {
        const product = edge.node;

        // Process images
        product.images = product.images.edges.map(imgEdge => imgEdge.node);

        // Process variants
        product.variants = product.variants.edges.map(varEdge => varEdge.node);

        // Process metafields
        product.metafields = product.metafields.edges.map(metaEdge => metaEdge.node);

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

      // Process variants
      product.variants = product.variants.edges.map(varEdge => varEdge.node);

      // Process metafields
      product.metafields = product.metafields.edges.map(metaEdge => metaEdge.node);

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

    const createProductMutation = `#graphql
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
        consola.info(`Creating product "${product.title}"`);
        const result = await client.graphql(createProductMutation, { input: productInput }, 'CreateProduct');
        if (result.productCreate.userErrors.length > 0) {
          consola.error(`Failed to create product "${product.title}":`, result.productCreate.userErrors);
          return null;
        }

        const newProduct = result.productCreate.product;

        // Step 2: Now create variants using productVariantsBulkCreate
        if (newProduct.id && product.variants && product.variants.length > 0) {
          await this.createProductVariants(client, newProduct.id, product.variants);
        }

        // Step 3: Upload images if any
        if (newProduct.id && product.images && product.images.length > 0) {
          await this.syncProductImages(client, newProduct.id, product.images);
        }

        // Step 4: Create metafields if any
        if (newProduct.id && product.metafields && product.metafields.length > 0) {
          await this.syncProductMetafields(client, newProduct.id, product.metafields);
        }

        return newProduct;
      } catch (error) {
        consola.error(`Error creating product "${product.title}": ${error.message}`);
        return null;
      }
    } else {
      consola.info(`[DRY RUN] Would create product "${product.title}"`);
      consola.info(`[DRY RUN] Would create ${product.variants ? product.variants.length : 0} variant(s)`);
      consola.info(`[DRY RUN] Would sync ${product.images ? product.images.length : 0} image(s) and ${product.metafields ? product.metafields.length : 0} metafield(s)`);
      return { id: "dry-run-id", title: product.title, handle: product.handle };
    }
  }

  async createProductVariants(client, productId, variants) {
    consola.info(`Creating ${variants.length} variants for product ID: ${productId}`);

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
      consola.warn(`Found ${duplicates.length} duplicate option combinations:`);
      duplicates.forEach(dup => consola.warn(`  - ${dup}`));
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

      // Log detailed info for debugging if in debug mode
      if (this.debug) {
        consola.debug(`Creating variant with options: ${JSON.stringify(variant.selectedOptions)}`);
      }

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

    // If we're in debug mode, log the full variant input payload
    if (this.debug) {
      consola.debug(`Variant creation payload: ${JSON.stringify(variantsInput, null, 2)}`);
    }

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
        // Try creating variants one by one if we get a bulk error
        let result;
        try {
          // First try creating all variants at once
          result = await client.graphql(createVariantsMutation, {
            productId,
            variants: variantsInput
          }, 'ProductVariantsBulkCreate');
        } catch (bulkError) {
          // If bulk creation fails completely, log and try individual creation
          consola.warn(`Bulk variant creation failed: ${bulkError.message}`);
          consola.info(`Attempting to create variants individually...`);

          // Fall back to individual variant creation
          const individualResults = {
            productVariantsBulkCreate: {
              productVariants: [],
              userErrors: []
            }
          };

          for (const [index, variantInput] of variantsInput.entries()) {
            try {
              const singleResult = await client.graphql(createVariantsMutation, {
                productId,
                variants: [variantInput]
              }, 'ProductVariantsBulkCreate');

              if (singleResult.productVariantsBulkCreate.productVariants.length > 0) {
                individualResults.productVariantsBulkCreate.productVariants.push(
                  singleResult.productVariantsBulkCreate.productVariants[0]
                );
              }

              if (singleResult.productVariantsBulkCreate.userErrors.length > 0) {
                individualResults.productVariantsBulkCreate.userErrors.push({
                  ...singleResult.productVariantsBulkCreate.userErrors[0],
                  field: [`variants`, `${index}`],
                });
              }
            } catch (individualError) {
              consola.error(`Failed to create variant #${index + 1}: ${individualError.message}`);
              individualResults.productVariantsBulkCreate.userErrors.push({
                field: [`variants`, `${index}`],
                message: individualError.message,
              });
            }
          }

          result = individualResults;
        }

        if (result.productVariantsBulkCreate.userErrors.length > 0) {
          consola.error(`Failed to create variants:`, result.productVariantsBulkCreate.userErrors);

          // Log created variants even if there were some errors
          if (result.productVariantsBulkCreate.productVariants.length > 0) {
            consola.info(`Successfully created ${result.productVariantsBulkCreate.productVariants.length} variants despite errors`);
          }

          return result.productVariantsBulkCreate.productVariants.length > 0;
        }

        consola.success(`Successfully created ${result.productVariantsBulkCreate.productVariants.length} variants`);
        return true;
      } catch (error) {
        consola.error(`Error creating variants: ${error.message}`);
        return false;
      }
    } else {
      consola.info(`[DRY RUN] Would create ${variantsInput.length} variants for product`);
      for (const [index, variantInput] of variantsInput.entries()) {
        const optionSummary = variantInput.optionValues
          .map(opt => `${opt.optionName}:${opt.name}`)
          .join(', ');
        consola.info(`[DRY RUN] Variant #${index + 1}: ${optionSummary}`);
      }
      return true;
    }
  }

  async updateProduct(client, product, existingProduct) {
    // Prepare input with the correct ProductUpdateInput structure
    const productUpdateInput = {
      id: existingProduct.id,
      title: product.title,
      descriptionHtml: product.descriptionHtml,
      vendor: product.vendor,
      productType: product.productType,
      status: product.status || 'ACTIVE',
      tags: product.tags
      // Don't include options or variants in update as they need special handling
    };

    // Use the correct parameter name 'product' not 'input' as per Shopify API docs
    const productUpdateMutation = `#graphql
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
        // Use consistent variable naming in the GraphQL call
        const result = await client.graphql(
          productUpdateMutation,
          { productUpdateInput },
          'ProductUpdate'
        );

        if (result.productUpdate.userErrors.length > 0) {
          consola.error(`Failed to update product "${product.title}":`, result.productUpdate.userErrors);
          return null;
        }

        const updatedProduct = result.productUpdate.product;

        // Step 1: Update variants separately using productVariantsBulkUpdate
        if (updatedProduct.id && product.variants && product.variants.length > 0) {
          await this.updateProductVariants(client, updatedProduct.id, product.variants);
        } else {
          consola.info(`No variants to update for "${product.title}"`);
        }

        // Step 2: Sync images and metafields
        if (updatedProduct.id) {
          // Update images if any
          if (product.images && product.images.length > 0) {
            await this.syncProductImages(client, updatedProduct.id, product.images);
          }

          // Update metafields if any
          if (product.metafields && product.metafields.length > 0) {
            await this.syncProductMetafields(client, updatedProduct.id, product.metafields);
          }
        }

        return updatedProduct;
      } catch (error) {
        consola.error(`Error updating product "${product.title}": ${error.message}`);
        return null;
      }
    } else {
      consola.info(`[DRY RUN] Would update product "${product.title}"`);
      consola.info(`[DRY RUN] Would update ${product.variants ? product.variants.length : 0} variant(s)`);
      consola.info(`[DRY RUN] Would sync ${product.images ? product.images.length : 0} image(s) and ${product.metafields ? product.metafields.length : 0} metafield(s)`);
      return { id: existingProduct.id, title: product.title, handle: product.handle };
    }
  }

  async updateProductVariants(client, productId, sourceVariants) {
    consola.info(`Preparing to update variants for product ID: ${productId}`);

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
              }
            }
          }
        }
      }
    `;

    let targetVariants = [];
    try {
      const response = await client.graphql(
        targetVariantsQuery,
        { productId },
        'GetProductVariants'
      );

      // Extract the variants from the response
      targetVariants = response.product.variants.edges.map(edge => edge.node);
      consola.info(`Found ${targetVariants.length} existing variants in target product`);

    } catch (error) {
      consola.error(`Error fetching target product variants: ${error.message}`);
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

    // Match source variants to target variants and prepare the update inputs
    const variantsToUpdate = [];
    const variantsToCreate = [];

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
      } else {
        // Variant doesn't exist in target - CREATE instead of just warning
        consola.info(`Preparing to create new variant with options: ${optionKey}`);

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
          }))
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
      consola.info(`Updating ${variantsToUpdate.length} existing variants for product ID: ${productId}`);

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
          const result = await client.graphql(updateVariantsMutation, {
            productId,
            variants: variantsToUpdate
          }, 'ProductVariantsBulkUpdate');

          if (result.productVariantsBulkUpdate.userErrors.length > 0) {
            consola.error(`Failed to update variants:`, result.productVariantsBulkUpdate.userErrors);
            updateSuccess = false;
          } else {
            consola.success(`Successfully updated ${result.productVariantsBulkUpdate.productVariants.length} variants`);
          }
        } catch (error) {
          consola.error(`Error updating variants: ${error.message}`);
          updateSuccess = false;
        }
      } else {
        consola.info(`[DRY RUN] Would update ${variantsToUpdate.length} variants for product ID: ${productId}`);
      }
    } else {
      consola.info(`No existing variants to update`);
    }

    // STEP 2: Create new variants that don't exist in target
    if (variantsToCreate.length > 0) {
      consola.info(`Creating ${variantsToCreate.length} new variants for product ID: ${productId}`);

      const createVariantsMutation = `#graphql
        mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkCreate(productId: $productId, variants: $variants) {
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
          const result = await client.graphql(createVariantsMutation, {
            productId,
            variants: variantsToCreate
          }, 'ProductVariantsBulkCreate');

          if (result.productVariantsBulkCreate.userErrors.length > 0) {
            consola.error(`Failed to create new variants:`, result.productVariantsBulkCreate.userErrors);
            createSuccess = false;
          } else {
            consola.success(`Successfully created ${result.productVariantsBulkCreate.productVariants.length} new variants`);
          }
        } catch (error) {
          consola.error(`Error creating new variants: ${error.message}`);
          createSuccess = false;
        }
      } else {
        consola.info(`[DRY RUN] Would create ${variantsToCreate.length} new variants for product ID: ${productId}`);
      }
    } else {
      consola.info(`No new variants to create`);
    }

    // Return overall success status
    return updateSuccess && createSuccess;
  }

  async syncProductImages(client, productId, images) {
    consola.info(`Syncing ${images.length} images for product ID: ${productId}`);

    // In a real implementation, you would:
    // 1. Get existing images
    // 2. Upload new images
    // 3. Delete removed images

    if (images.length === 0) return;

    // Create media inputs from the images
    const mediaInputs = images.map(image => ({
      originalSource: image.src,
      alt: image.altText || '',
      mediaContentType: 'IMAGE'
    }));

    const mutation = `#graphql
      mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media {
            ... on MediaImage {
              id
              image {
                id
                url
              }
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
        consola.info(`Uploading ${mediaInputs.length} images for product`);
        const result = await client.graphql(mutation, {
          productId,
          media: mediaInputs
        }, 'ProductCreateMedia');

        if (result.productCreateMedia.userErrors.length > 0) {
          consola.error(`Failed to upload product images:`, result.productCreateMedia.userErrors);
        } else {
          consola.success(`Successfully uploaded ${result.productCreateMedia.media.length} images`);
        }
      } catch (error) {
        consola.error(`Error uploading product images: ${error.message}`);
      }
    } else {
      consola.info(`[DRY RUN] Would upload ${mediaInputs.length} images for product`);
      for (const input of mediaInputs) {
        consola.info(`[DRY RUN] Image: ${input.originalSource} (${input.alt || 'No alt text'})`);
      }
    }
  }

  async syncProductMetafields(client, productId, metafields) {
    if (!metafields || metafields.length === 0) return;

    consola.info(`Syncing ${metafields.length} metafields for product ID: ${productId}`);

    // Prepare all metafields inputs in a single array
    const metafieldsInput = metafields.map(metafield => ({
      ownerId: productId,
      namespace: metafield.namespace,
      key: metafield.key,
      value: metafield.value,
      type: metafield.type
    }));

    const mutation = `#graphql
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
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
        const result = await client.graphql(mutation, { metafields: metafieldsInput }, 'MetafieldsSet');

        if (result.metafieldsSet.userErrors.length > 0) {
          consola.error(`Failed to set metafields:`, result.metafieldsSet.userErrors);
          return false;
        } else {
          const metafieldCount = result.metafieldsSet.metafields.length;
          consola.success(`Successfully set ${metafieldCount} metafields for product ID: ${productId}`);

          // Log individual metafields if debug is enabled
          if (this.debug) {
            result.metafieldsSet.metafields.forEach(metafield => {
              consola.debug(`Set metafield ${metafield.namespace}.${metafield.key}`);
            });
          }

          return true;
        }
      } catch (error) {
        consola.error(`Error setting metafields: ${error.message}`);
        return false;
      }
    } else {
      consola.info(`[DRY RUN] Would set ${metafieldsInput.length} metafields for product ID: ${productId}`);

      // Log individual metafields if debug is enabled
      if (this.debug) {
        metafields.forEach(metafield => {
          consola.debug(`[DRY RUN] Would set metafield ${metafield.namespace}.${metafield.key}`);
        });
      }

      return true;
    }
  }

  // --- Sync Orchestration Methods ---

  async sync() {
    consola.start(`Syncing products...`);

    // Fetch products from source shop
    const sourceProducts = await this.fetchProducts(this.sourceClient, this.options.limit);
    consola.info(`Found ${sourceProducts.length} product(s) in source shop`);

    const results = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let processedCount = 0;

    // Process each source product
    for (const product of sourceProducts) {
      if (processedCount >= this.options.limit) {
        consola.info(`Reached processing limit (${this.options.limit}). Stopping product sync.`);
        break;
      }

      // Check if product exists in target shop by handle
      const targetProduct = await this.getProductByHandle(this.targetClient, product.handle);

      if (targetProduct) {
        // Update existing product
        consola.info(`Updating product: ${product.title} (${product.handle})`);
        const updated = await this.updateProduct(this.targetClient, product, targetProduct);
        updated ? results.updated++ : results.failed++;
      } else {
        // Create new product
        consola.info(`Creating product: ${product.title} (${product.handle})`);
        const created = await this.createProduct(this.targetClient, product);
        created ? results.created++ : results.failed++;
      }

      processedCount++;
    }

    consola.success(`Finished syncing products.`);
    return { definitionResults: results, dataResults: null };
  }
}

module.exports = ProductSyncStrategy;
