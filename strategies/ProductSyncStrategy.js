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
        consola.info(`  • Creating base product "${product.title}"`);
        const result = await client.graphql(createProductMutation, { input: productInput }, 'CreateProduct');
        if (result.productCreate.userErrors.length > 0) {
          consola.error(`    ✖ Failed to create product "${product.title}":`, result.productCreate.userErrors);
          return null;
        }

        const newProduct = result.productCreate.product;
        consola.success(`    ✓ Base product created successfully`);

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

        // Step 5: Sync publication status if any
        if (newProduct.id && product.publications && product.publications.length > 0) {
          await this.syncProductPublications(client, newProduct.id, product.publications);
        }

        return newProduct;
      } catch (error) {
        consola.error(`    ✖ Error creating product "${product.title}": ${error.message}`);
        return null;
      }
    } else {
      consola.info(`  • [DRY RUN] Would create product "${product.title}"`);
      consola.info(`    - [DRY RUN] Would create ${product.variants ? product.variants.length : 0} variant(s)`);
      consola.info(`    - [DRY RUN] Would sync ${product.images ? product.images.length : 0} image(s) and ${product.metafields ? product.metafields.length : 0} metafield(s)`);

      if (product.publications && product.publications.length > 0) {
        const publishedChannels = product.publications
          .filter(pub => pub.isPublished)
          .map(pub => pub.channel.handle);
        consola.info(`    - [DRY RUN] Would publish to ${publishedChannels.length} channels: ${publishedChannels.join(', ')}`);
      }

      return { id: "dry-run-id", title: product.title, handle: product.handle };
    }
  }

  async createProductVariants(client, productId, variants) {
    consola.info(`• Creating ${variants.length} variants for product ID: ${productId}`);

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
      consola.warn(`  - Found ${duplicates.length} duplicate option combinations:`);
      duplicates.forEach(dup => consola.warn(`    - ${dup}`));
    }

    // First, we need to create all product images to be able to reference them
    // Collect all unique variant images that need to be uploaded
    const variantImagesToUpload = [];

    for (const variant of variants) {
      if (variant.image && variant.image.src) {
        const alreadyAdded = variantImagesToUpload.some(img =>
          img.src === variant.image.src
        );

        if (!alreadyAdded) {
          variantImagesToUpload.push({
            src: variant.image.src,
            altText: variant.image.altText || ''
          });
        }
      }
    }

    // Upload all variant images to the product first
    let uploadedImages = [];
    if (variantImagesToUpload.length > 0) {
      consola.info(`  - Uploading ${variantImagesToUpload.length} variant images to product`);

      if (this.options.notADrill) {
        try {
          await this.syncProductImages(client, productId, variantImagesToUpload);

          // Now fetch the uploaded images to get their IDs
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

          const response = await client.graphql(imagesQuery, { productId }, 'GetProductImages');
          uploadedImages = response.product.images.edges.map(edge => edge.node);
          consola.info(`    - Retrieved ${uploadedImages.length} images from product`);
        } catch (error) {
          consola.error(`    ✖ Error preparing variant images: ${error.message}`);
        }
      }
    }

    // Create a map to look up image IDs by source URL
    const imageIdMap = {};
    uploadedImages.forEach(img => {
      const filename = img.src.split('/').pop().split('?')[0];
      imageIdMap[filename] = img.id;
    });

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
        consola.debug(`    - Creating variant with options: ${JSON.stringify(variant.selectedOptions)}`);
        if (variant.image) {
          consola.debug(`      - Variant has image: ${variant.image.src}`);
        }
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
      consola.debug(`  - Variant creation payload: ${JSON.stringify(variantsInput, null, 2)}`);
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
          consola.warn(`  ⚠ Bulk variant creation failed: ${bulkError.message}`);
          consola.info(`  - Attempting to create variants individually...`);

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
              consola.error(`    ✖ Failed to create variant #${index + 1}: ${individualError.message}`);
              individualResults.productVariantsBulkCreate.userErrors.push({
                field: [`variants`, `${index}`],
                message: individualError.message,
              });
            }
          }

          result = individualResults;
        }

        if (result.productVariantsBulkCreate.userErrors.length > 0) {
          consola.error(`  ✖ Failed to create variants:`, result.productVariantsBulkCreate.userErrors);

          // Log created variants even if there were some errors
          if (result.productVariantsBulkCreate.productVariants.length > 0) {
            consola.info(`  ✓ Successfully created ${result.productVariantsBulkCreate.productVariants.length} variants despite errors`);
          }

          // Return false if no variants were created
          if (result.productVariantsBulkCreate.productVariants.length === 0) {
            return false;
          }
        }

        consola.success(`  ✓ Successfully created ${result.productVariantsBulkCreate.productVariants.length} variants`);

        // Now handle metafields for each created variant
        for (let i = 0; i < result.productVariantsBulkCreate.productVariants.length; i++) {
          const createdVariant = result.productVariantsBulkCreate.productVariants[i];

          // Find the source variant that matches this created variant by options
          const matchingSourceVariant = this.findMatchingVariantByOptions(
            variants,
            createdVariant.selectedOptions
          );

          // Handle variant metafields
          if (matchingSourceVariant && matchingSourceVariant.metafields && matchingSourceVariant.metafields.length > 0) {
            await this.syncVariantMetafields(client, createdVariant, matchingSourceVariant.metafields);
          }

          // Set the variant's image if one exists
          if (matchingSourceVariant && matchingSourceVariant.image && matchingSourceVariant.image.src) {
            const sourceFilename = matchingSourceVariant.image.src.split('/').pop().split('?')[0];
            if (imageIdMap[sourceFilename]) {
              await this.updateVariantImage(client, createdVariant.id, imageIdMap[sourceFilename], productId);
            }
          }
        }

        return true;
      } catch (error) {
        consola.error(`  ✖ Error creating variants: ${error.message}`);
        return false;
      }
    } else {
      consola.info(`  - [DRY RUN] Would create ${variantsInput.length} variants for product`);

      if (variantImagesToUpload.length > 0) {
        consola.info(`    - [DRY RUN] Would upload ${variantImagesToUpload.length} variant images`);
      }

      for (const [index, variantInput] of variantsInput.entries()) {
        const optionSummary = variantInput.optionValues
          .map(opt => `${opt.optionName}:${opt.name}`)
          .join(', ');
        consola.info(`    - [DRY RUN] Variant #${index + 1}: ${optionSummary}`);

        const sourceVariant = variants[index];
        if (sourceVariant && sourceVariant.image) {
          consola.info(`      - [DRY RUN] Would assign image: ${sourceVariant.image.src}`);
        }

        // Check if source variant has metafields
        if (sourceVariant && sourceVariant.metafields && sourceVariant.metafields.length > 0) {
          consola.info(`      - [DRY RUN] Would sync ${sourceVariant.metafields.length} metafields for this variant`);
        }
      }
      return true;
    }
  }

  // Helper method to find matching variant by option values
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
        consola.info(`  • Updating base product data`);
        const result = await client.graphql(
          productUpdateMutation,
          { productUpdateInput },
          'ProductUpdate'
        );

        if (result.productUpdate.userErrors.length > 0) {
          consola.error(`    ✖ Failed to update product "${product.title}":`, result.productUpdate.userErrors);
          return null;
        }

        const updatedProduct = result.productUpdate.product;
        consola.success(`    ✓ Base product data updated successfully`);

        // Step 1: Update variants separately using productVariantsBulkUpdate
        if (updatedProduct.id && product.variants && product.variants.length > 0) {
          await this.updateProductVariants(client, updatedProduct.id, product.variants);
        } else {
          consola.info(`    - No variants to update for "${product.title}"`);
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

          // Sync publication status if any
          if (product.publications && product.publications.length > 0) {
            await this.syncProductPublications(client, updatedProduct.id, product.publications);
          }
        }

        return updatedProduct;
      } catch (error) {
        consola.error(`    ✖ Error updating product "${product.title}": ${error.message}`);
        return null;
      }
    } else {
      consola.info(`  • [DRY RUN] Would update product "${product.title}"`);
      consola.info(`    - [DRY RUN] Would update ${product.variants ? product.variants.length : 0} variant(s)`);
      consola.info(`    - [DRY RUN] Would sync ${product.images ? product.images.length : 0} image(s) and ${product.metafields ? product.metafields.length : 0} metafield(s)`);

      if (product.publications && product.publications.length > 0) {
        const publishedChannels = product.publications
          .filter(pub => pub.isPublished)
          .map(pub => pub.channel.handle);
        consola.info(`    - [DRY RUN] Would publish to ${publishedChannels.length} channels: ${publishedChannels.join(', ')}`);
      }

      return { id: existingProduct.id, title: product.title, handle: product.handle };
    }
  }

  async updateProductVariants(client, productId, sourceVariants) {
    consola.info(`• Preparing to update variants for product ID: ${productId}`);

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
      const response = await client.graphql(
        targetVariantsQuery,
        { productId },
        'GetProductVariants'
      );

      // Extract the variants from the response
      targetVariants = response.product.variants.edges.map(edge => edge.node);
      targetImages = response.product.images.edges.map(edge => edge.node);

      consola.info(`  - Found ${targetVariants.length} existing variants in target product`);
      consola.info(`  - Found ${targetImages.length} existing images in target product`);

    } catch (error) {
      consola.error(`  ✖ Error fetching target product variants: ${error.message}`);
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
    const imageIdMap = {};
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
    if (variantImagesToUpload.length > 0 && this.options.notADrill) {
      consola.info(`  - Uploading ${variantImagesToUpload.length} new variant images`);

      try {
        await this.syncProductImages(client, productId, variantImagesToUpload);

        // Refresh the image list to get new IDs
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

        const response = await client.graphql(imagesQuery, { productId }, 'GetProductImages');
        targetImages = response.product.images.edges.map(edge => edge.node);

        // Update the image ID map
        targetImages.forEach(img => {
          const filename = img.src.split('/').pop().split('?')[0];
          imageIdMap[filename] = img.id;
        });

      } catch (error) {
        consola.error(`    ✖ Error uploading variant images: ${error.message}`);
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
        consola.info(`  - Preparing to create new variant with options: ${optionKey}`);

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
      consola.info(`  - Updating ${variantsToUpdate.length} existing variants for product ID: ${productId}`);

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
            consola.error(`    ✖ Failed to update variants:`, result.productVariantsBulkUpdate.userErrors);
            updateSuccess = false;
          } else {
            consola.success(`    ✓ Successfully updated ${result.productVariantsBulkUpdate.productVariants.length} variants`);

            // Update the variant images separately since imageId isn't supported in bulk updates
            if (imageUpdates.length > 0) {
              consola.info(`    - Updating images for ${imageUpdates.length} variants`);

              for (const update of imageUpdates) {
                await this.updateVariantImage(client, update.variantId, update.imageId, productId);
              }
            }

            // Now update metafields for each variant
            for (const metafieldUpdate of metafieldUpdates) {
              await this.syncVariantMetafields(
                client,
                { id: metafieldUpdate.targetVariantId },
                metafieldUpdate.metafields
              );
            }
          }
        } catch (error) {
          consola.error(`    ✖ Error updating variants: ${error.message}`);
          updateSuccess = false;
        }
      } else {
        consola.info(`    - [DRY RUN] Would update ${variantsToUpdate.length} variants for product ID: ${productId}`);

        if (imageUpdates.length > 0) {
          consola.info(`      - [DRY RUN] Would update images for ${imageUpdates.length} variants`);
        }

        // Log metafield updates
        for (const metafieldUpdate of metafieldUpdates) {
          consola.info(`      - [DRY RUN] Would update ${metafieldUpdate.metafields.length} metafields for variant ID: ${metafieldUpdate.targetVariantId}`);
        }
      }
    } else {
      consola.info(`  - No existing variants to update`);
    }

    // STEP 2: Create new variants that don't exist in target
    if (variantsToCreate.length > 0) {
      consola.info(`  - Creating ${variantsToCreate.length} new variants for product ID: ${productId}`);

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
          const result = await client.graphql(createVariantsMutation, {
            productId,
            variants: createInputs
          }, 'ProductVariantsBulkCreate');

          if (result.productVariantsBulkCreate.userErrors.length > 0) {
            consola.error(`    ✖ Failed to create new variants:`, result.productVariantsBulkCreate.userErrors);
            createSuccess = false;
          } else {
            consola.success(`    ✓ Successfully created ${result.productVariantsBulkCreate.productVariants.length} new variants`);

            // Now handle metafields and images for each created variant
            for (let i = 0; i < result.productVariantsBulkCreate.productVariants.length; i++) {
              const createdVariant = result.productVariantsBulkCreate.productVariants[i];
              const sourceMetafields = variantsToCreate[i].sourceMetafields;
              const sourceImage = variantsToCreate[i].sourceImage;

              // Handle metafields
              if (sourceMetafields && sourceMetafields.length > 0) {
                await this.syncVariantMetafields(client, createdVariant, sourceMetafields);
              }

              // Handle image
              if (sourceImage && sourceImage.src) {
                const sourceFilename = sourceImage.src.split('/').pop().split('?')[0];
                if (imageIdMap[sourceFilename]) {
                  await this.updateVariantImage(client, createdVariant.id, imageIdMap[sourceFilename], productId);
                }
              }
            }
          }
        } catch (error) {
          consola.error(`    ✖ Error creating new variants: ${error.message}`);
          createSuccess = false;
        }
      } else {
        consola.info(`    - [DRY RUN] Would create ${variantsToCreate.length} new variants for product ID: ${productId}`);

        // Log variant image and metafield creation info
        for (let i = 0; i < variantsToCreate.length; i++) {
          if (variantsToCreate[i].sourceImage) {
            consola.info(`      - [DRY RUN] New variant #${i + 1} would have an image assigned`);
          }

          const sourceMetafields = variantsToCreate[i].sourceMetafields;
          if (sourceMetafields && sourceMetafields.length > 0) {
            consola.info(`      - [DRY RUN] Would create ${sourceMetafields.length} metafields for new variant #${i + 1}`);
          }
        }
      }
    } else {
      consola.info(`  - No new variants to create`);
    }

    // Return overall success status
    return updateSuccess && createSuccess;
  }

  async syncProductImages(client, productId, sourceImages) {
    if (!sourceImages || sourceImages.length === 0) return true;

    consola.info(`    • Processing ${sourceImages.length} images for product`);

    // Step 1: Get existing images to avoid duplicates
    const existingImagesQuery = `#graphql
      query getProductMedia($productId: ID!) {
        product(id: $productId) {
          media(first: 50) {
            edges {
              node {
                id
                mediaContentType
                ... on MediaImage {
                  image {
                    originalSrc
                  }
                }
                alt
              }
            }
          }
        }
      }
    `;

    let existingImages = [];
    try {
      const response = await client.graphql(existingImagesQuery, { productId }, 'GetProductMedia');
      existingImages = response.product.media.edges.map(edge => edge.node);
      consola.info(`      - Found ${existingImages.length} existing images on product`);
    } catch (error) {
      consola.error(`      ✖ Error fetching existing product images: ${error.message}`);
      return false;
    }

    // Create a map of existing images by source URL for easy comparison
    const existingImageMap = {};
    existingImages.forEach(img => {
      if (img.mediaContentType === 'IMAGE' && img.image && img.image.originalSrc) {
        // Use just the filename for comparison to handle URL differences
        const filename = img.image.originalSrc.split('/').pop().split('?')[0];
        existingImageMap[filename] = img;
      }
    });

    // Filter out images that already exist
    const newImagesToUpload = sourceImages.filter(img => {
      const sourceSrc = img.src;
      const sourceFilename = sourceSrc.split('/').pop().split('?')[0];
      return !existingImageMap[sourceFilename];
    });

    if (newImagesToUpload.length === 0) {
      consola.info(`      - All images already exist on product, no need to upload`);
      return true;
    }

    // Create media inputs from the new images
    const mediaInputs = newImagesToUpload.map(image => ({
      originalSource: image.src,
      alt: image.altText || '',
      mediaContentType: 'IMAGE'
    }));

    const createMediaMutation = `#graphql
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
        consola.info(`      - Uploading ${mediaInputs.length} new images for product`);
        const result = await client.graphql(createMediaMutation, {
          productId,
          media: mediaInputs
        }, 'ProductCreateMedia');

        if (result.productCreateMedia.userErrors.length > 0) {
          consola.error(`      ✖ Failed to upload product images:`, result.productCreateMedia.userErrors);
          return false;
        } else {
          consola.success(`      ✓ Successfully uploaded ${result.productCreateMedia.media.length} images`);

          // Get the IDs of the newly created media
          const newMediaIds = result.productCreateMedia.media.map(media => media.id);

          return true;
        }
      } catch (error) {
        consola.error(`      ✖ Error uploading product images: ${error.message}`);
        return false;
      }
    } else {
      consola.info(`      - [DRY RUN] Would upload ${mediaInputs.length} new images for product`);
      for (const input of mediaInputs) {
        consola.info(`        - [DRY RUN] Image: ${input.originalSource} (${input.alt || 'No alt text'})`);
      }
      return true;
    }
  }

  async syncProductMetafields(client, productId, metafields) {
    if (!metafields || metafields.length === 0) return true;

    consola.info(`• Syncing ${metafields.length} metafields for product ID: ${productId}`);

    // Shopify has a limit of 25 metafields per API call
    const BATCH_SIZE = 25;
    const metafieldBatches = [];

    // Split metafields into batches of 25
    for (let i = 0; i < metafields.length; i += BATCH_SIZE) {
      metafieldBatches.push(metafields.slice(i, i + BATCH_SIZE));
    }

    consola.info(`  - Processing ${metafieldBatches.length} batches of metafields (max ${BATCH_SIZE} per batch)`);

    let successCount = 0;
    let failedCount = 0;

    // Process each batch
    for (const [batchIndex, metafieldBatch] of metafieldBatches.entries()) {
      // Prepare metafields inputs for this batch
      const metafieldsInput = metafieldBatch.map(metafield => ({
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
          consola.info(`    - Processing batch ${batchIndex + 1}/${metafieldBatches.length} (${metafieldBatch.length} metafields)`);
          const result = await client.graphql(mutation, { metafields: metafieldsInput }, 'MetafieldsSet');

          if (result.metafieldsSet.userErrors.length > 0) {
            consola.error(`    ✖ Failed to set product metafields in batch ${batchIndex + 1}:`, result.metafieldsSet.userErrors);
            failedCount += metafieldBatch.length;
          } else {
            const metafieldCount = result.metafieldsSet.metafields.length;
            consola.success(`    ✓ Successfully set ${metafieldCount} metafields in batch ${batchIndex + 1}`);
            successCount += metafieldCount;

            // Log individual metafields if debug is enabled
            if (this.debug) {
              result.metafieldsSet.metafields.forEach(metafield => {
                consola.debug(`      - Set product metafield ${metafield.namespace}.${metafield.key}`);
              });
            }
          }
        } catch (error) {
          consola.error(`    ✖ Error setting product metafields in batch ${batchIndex + 1}: ${error.message}`);
          failedCount += metafieldBatch.length;
        }
      } else {
        consola.info(`    - [DRY RUN] Would set ${metafieldBatch.length} metafields for product ID: ${productId} in batch ${batchIndex + 1}`);

        // Log individual metafields if debug is enabled
        if (this.debug) {
          metafieldBatch.forEach(metafield => {
            consola.debug(`      - [DRY RUN] Would set product metafield ${metafield.namespace}.${metafield.key}`);
          });
        }
      }
    }

    // Return success status
    if (this.options.notADrill) {
      consola.info(`  - Product metafields sync complete: ${successCount} successful, ${failedCount} failed`);
      return failedCount === 0;
    } else {
      return true;
    }
  }

  async syncVariantMetafields(client, variant, metafields) {
    if (!metafields || metafields.length === 0) return true;

    consola.info(`  • Syncing ${metafields.length} metafields for variant ID: ${variant.id}`);

    // Shopify has a limit of 25 metafields per API call
    const BATCH_SIZE = 25;
    const metafieldBatches = [];

    // Split metafields into batches of 25
    for (let i = 0; i < metafields.length; i += BATCH_SIZE) {
      metafieldBatches.push(metafields.slice(i, i + BATCH_SIZE));
    }

    consola.info(`    - Processing ${metafieldBatches.length} batches of metafields (max ${BATCH_SIZE} per batch)`);

    let successCount = 0;
    let failedCount = 0;

    // Process each batch
    for (const [batchIndex, metafieldBatch] of metafieldBatches.entries()) {
      // Prepare metafields inputs for this batch
      const metafieldsInput = metafieldBatch.map(metafield => ({
        ownerId: variant.id,
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
          consola.info(`      - Processing batch ${batchIndex + 1}/${metafieldBatches.length} (${metafieldBatch.length} metafields)`);
          const result = await client.graphql(mutation, { metafields: metafieldsInput }, 'MetafieldsSet');

          if (result.metafieldsSet.userErrors.length > 0) {
            consola.error(`      ✖ Failed to set variant metafields in batch ${batchIndex + 1}:`, result.metafieldsSet.userErrors);
            failedCount += metafieldBatch.length;
          } else {
            const metafieldCount = result.metafieldsSet.metafields.length;
            consola.success(`      ✓ Successfully set ${metafieldCount} metafields in batch ${batchIndex + 1}`);
            successCount += metafieldCount;

            // Log individual metafields if debug is enabled
            if (this.debug) {
              result.metafieldsSet.metafields.forEach(metafield => {
                consola.debug(`        - Set variant metafield ${metafield.namespace}.${metafield.key}`);
              });
            }
          }
        } catch (error) {
          consola.error(`      ✖ Error setting variant metafields in batch ${batchIndex + 1}: ${error.message}`);
          failedCount += metafieldBatch.length;
        }
      } else {
        consola.info(`      - [DRY RUN] Would set ${metafieldBatch.length} metafields for variant ID: ${variant.id} in batch ${batchIndex + 1}`);

        // Log individual metafields if debug is enabled
        if (this.debug) {
          metafieldBatch.forEach(metafield => {
            consola.debug(`        - [DRY RUN] Would set variant metafield ${metafield.namespace}.${metafield.key}`);
          });
        }
      }
    }

    // Return success status
    if (this.options.notADrill) {
      consola.info(`    - Variant metafields sync complete: ${successCount} successful, ${failedCount} failed`);
      return failedCount === 0;
    } else {
      return true;
    }
  }

  async updateVariantImage(client, variantId, imageId, productId) {
    // Validate IDs
    if (!variantId || !imageId) {
      consola.error(`      ✖ Invalid parameters: variantId or imageId is missing`);
      return false;
    }

    // Make sure we're working with valid ID format
    if (!variantId.startsWith('gid://') || !imageId.startsWith('gid://')) {
      consola.error(`      ✖ Invalid ID format for variant or image`);
      return false;
    }

    // Extract productId from variantId if not provided
    if (!productId) {
      try {
        const getVariantQuery = `#graphql
          query getVariantProduct($variantId: ID!) {
            productVariant(id: $variantId) {
              product {
                id
              }
            }
          }
        `;

        const response = await client.graphql(getVariantQuery, { variantId }, 'getVariantProduct');
        productId = response.productVariant.product.id;
      } catch (error) {
        consola.error(`      ✖ Could not determine product ID for variant`);
        return false;
      }
    }

    // Validate we have a product ID
    if (!productId || !productId.startsWith('gid://')) {
      consola.error(`      ✖ Invalid product ID`);
      return false;
    }

    // Convert ProductImage ID to MediaImage ID if needed
    if (imageId.includes('ProductImage/')) {
      try {
        const getProductMediaQuery = `#graphql
          query getProductMedia($productId: ID!) {
            product(id: $productId) {
              media(first: 50) {
                edges {
                  node {
                    id
                    ... on MediaImage {
                      image {
                        id
                        originalSrc
                      }
                    }
                  }
                }
              }
            }
          }
        `;

        const response = await client.graphql(getProductMediaQuery, { productId }, 'getProductMedia');
        const mediaItems = response.product.media.edges.map(edge => edge.node);

        // Look for a media item whose image.id matches our ProductImage ID
        let foundMediaId = null;
        for (const media of mediaItems) {
          if (media.image && media.image.id === imageId) {
            foundMediaId = media.id;
            break;
          }
        }

        if (foundMediaId) {
          imageId = foundMediaId;
        } else {
          // If we can't find a direct match, get the product's images and try to match by URL
          const getProductImagesQuery = `#graphql
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

          const imagesResponse = await client.graphql(getProductImagesQuery, { productId }, 'getProductImages');
          const images = imagesResponse.product.images.edges.map(edge => edge.node);

          // Find the image with the matching ID
          const matchingImage = images.find(img => img.id === imageId);

          if (matchingImage) {
            // Now look for a media item with a matching image URL
            for (const media of mediaItems) {
              if (media.image &&
                  media.image.originalSrc &&
                  matchingImage.src &&
                  this.normalizeUrl(media.image.originalSrc) === this.normalizeUrl(matchingImage.src)) {
                foundMediaId = media.id;
                break;
              }
            }

            if (foundMediaId) {
              imageId = foundMediaId;
            } else {
              consola.error(`      ✖ Could not find a MediaImage corresponding to ProductImage`);
              return false;
            }
          } else {
            consola.error(`      ✖ Could not find image on product`);
            return false;
          }
        }
      } catch (error) {
        consola.error(`      ✖ Error converting ProductImage to MediaImage`);
        return false;
      }
    }

    // Confirm we now have a MediaImage ID
    if (!imageId.includes('MediaImage/')) {
      consola.error(`      ✖ Unable to use image: ID is not a MediaImage ID`);
      return false;
    }

    // Check if the variant already has this media attached
    try {
      const checkVariantMediaQuery = `#graphql
        query checkVariantMedia($variantId: ID!) {
          productVariant(id: $variantId) {
            media(first: 10) {
              nodes {
                id
              }
            }
          }
        }
      `;

      const response = await client.graphql(checkVariantMediaQuery, { variantId }, 'checkVariantMedia');

      if (response.productVariant?.media?.nodes) {
        const existingMediaIds = response.productVariant.media.nodes.map(node => node.id);

        // If the variant already has this media attached, we can skip the operation
        if (existingMediaIds.includes(imageId)) {
          consola.info(`      - Variant already has the image attached, skipping`);
          return true;
        }

        // If the variant has different media attached, we need to detach it first
        if (existingMediaIds.length > 0) {
          const detachMediaMutation = `#graphql
            mutation productVariantDetachMedia($variantId: ID!, $mediaIds: [ID!]!) {
              productVariantDetachMedia(
                variantId: $variantId,
                mediaIds: $mediaIds
              ) {
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

          // Detach existing media
          try {
            const detachResult = await client.graphql(detachMediaMutation, {
              variantId,
              mediaIds: existingMediaIds
            }, 'productVariantDetachMedia');

            if (detachResult.productVariantDetachMedia.userErrors.length > 0) {
              consola.warn(`      ⚠ Failed to detach existing media, but will continue with attach operation`);
            }
          } catch (error) {
            consola.warn(`      ⚠ Error detaching media: ${error.message}, but will continue with attach operation`);
          }
        }
      }
    } catch (error) {
      consola.warn(`      ⚠ Could not check existing variant media: ${error.message}, will continue anyway`);
    }

    // The mutation to append media to variant
    const variantAppendMediaMutation = `#graphql
      mutation productVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
        productVariantAppendMedia(
          productId: $productId,
          variantMedia: $variantMedia
        ) {
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
        consola.info(`      - Updating variant image`);

        // Append the new media
        const result = await client.graphql(variantAppendMediaMutation, {
          productId: productId,
          variantMedia: [
            {
              variantId: variantId,
              mediaIds: [imageId]
            }
          ]
        }, 'productVariantAppendMedia');

        if (result.productVariantAppendMedia.userErrors.length > 0) {
          consola.error(`      ✖ Failed to update variant image:`, result.productVariantAppendMedia.userErrors);
          return false;
        } else {
          consola.success(`      ✓ Successfully updated variant image`);
          return true;
        }
      } catch (error) {
        consola.error(`      ✖ Error updating variant image: ${error.message}`);
        return false;
      }
    } else {
      consola.info(`      - [DRY RUN] Would update variant image`);
      return true;
    }
  }

  // Helper to normalize URLs for comparison
  normalizeUrl(url) {
    if (!url) return '';
    // Remove protocol, query params, and normalize to lowercase
    return url.replace(/^https?:\/\//, '')
              .split('?')[0]
              .toLowerCase();
  }

  async syncProductPublications(client, productId, publications) {
    if (!publications || publications.length === 0) {
      consola.info(`    - No publication channels to sync`);
      return true;
    }

    consola.info(`    • Syncing product publication to ${publications.length} channels`);

    // First, get available channels and publications in the target store
    const getPublicationsQuery = `#graphql
      query GetPublicationsAndChannels {
        publications(first: 25) {
          edges {
            node {
              id
              name
              app {
                id
              }
            }
          }
        }
        channels(first: 25) {
          edges {
            node {
              id
              name
              handle
            }
          }
        }
      }
    `;

    let targetChannels = [];
    let targetPublications = [];
    try {
      const response = await client.graphql(getPublicationsQuery, {}, 'GetPublicationsAndChannels');
      targetChannels = response.channels.edges.map(edge => edge.node);
      targetPublications = response.publications.edges.map(edge => edge.node);

      if (this.debug) {
        consola.debug(`      - Found ${targetChannels.length} available channels in target store`);
        consola.debug(`      - Found ${targetPublications.length} publications in target store`);
      }
    } catch (error) {
      consola.error(`      ✖ Error fetching target store publications: ${error.message}`);
      return false;
    }

    // Get current publication status for this product
    const getProductPublicationsQuery = `#graphql
      query GetProductPublications($productId: ID!) {
        product(id: $productId) {
          publications(first: 25) {
            edges {
              node {
                channel {
                  id
                  handle
                }
                isPublished
              }
            }
          }
        }
      }
    `;

    let currentPublications = [];
    try {
      const response = await client.graphql(getProductPublicationsQuery, { productId }, 'GetProductPublications');
      if (response.product && response.product.publications) {
        currentPublications = response.product.publications.edges.map(edge => edge.node);
      }

      if (this.debug) {
        consola.debug(`      - Product is currently published to ${currentPublications.length} channels`);
      }
    } catch (error) {
      consola.warn(`      ⚠ Unable to fetch current publications: ${error.message}`);
      // Continue anyway since we can still try to publish
    }

    // Match source publications to target channels by handle
    const publicationsToCreate = [];
    const skippedChannels = [];

    // For each source publication
    for (const sourcePublication of publications) {
      // Only process publications that are actually published
      if (!sourcePublication.isPublished) continue;

      const sourceChannelHandle = sourcePublication.channel.handle;

      // Find matching target channel
      const targetChannel = targetChannels.find(channel => channel.handle === sourceChannelHandle);
      if (targetChannel) {
        // Find the publication associated with this channel
        // For now, use the first publication as a default if we don't have more info
        // In most cases, there will only be a single publication (the default one)
        const targetPublication = targetPublications.length > 0 ? targetPublications[0] : null;

        if (targetPublication) {
          // Check if product is already published to this channel
          const alreadyPublished = currentPublications.some(pub =>
            pub.channel.handle === sourceChannelHandle && pub.isPublished
          );

          if (!alreadyPublished) {
            publicationsToCreate.push({
              publicationId: targetPublication.id,
              channelHandle: sourceChannelHandle
            });
          } else if (this.debug) {
            consola.debug(`      - Product already published to ${sourceChannelHandle}`);
          }
        } else {
          consola.warn(`      ⚠ Found channel ${sourceChannelHandle} but no associated publication in target store`);
          skippedChannels.push(sourceChannelHandle);
        }
      } else {
        skippedChannels.push(sourceChannelHandle);
      }
    }

    // Log skipped channels
    if (skippedChannels.length > 0) {
      consola.warn(`      ⚠ Skipping ${skippedChannels.length} channels that don't exist in target store: ${skippedChannels.join(', ')}`);
    }

    // If no publications to create, we're done
    if (publicationsToCreate.length === 0) {
      consola.info(`      - No new publication channels to add`);
      return true;
    }

    // Publish to target channels
    const publishMutation = `#graphql
      mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors {
            field
            message
          }
        }
      }
    `;

    if (this.options.notADrill) {
      try {
        consola.info(`      - Publishing product to ${publicationsToCreate.length} channels`);

        const input = publicationsToCreate.map(pub => ({
          publicationId: pub.publicationId,
          // Use current date for publish date
          publishDate: new Date().toISOString()
        }));

        const result = await client.graphql(publishMutation, {
          id: productId,
          input
        }, 'publishablePublish');

        if (result.publishablePublish.userErrors.length > 0) {
          consola.error(`      ✖ Failed to publish product:`, result.publishablePublish.userErrors);
          return false;
        } else {
          consola.success(`      ✓ Successfully published product to ${publicationsToCreate.length} channels`);
          return true;
        }
      } catch (error) {
        consola.error(`      ✖ Error publishing product: ${error.message}`);
        return false;
      }
    } else {
      consola.info(`      - [DRY RUN] Would publish product to ${publicationsToCreate.length} channels`);
      for (const pub of publicationsToCreate) {
        consola.info(`        - [DRY RUN] Channel: ${pub.channelHandle}`);
      }
      return true;
    }
  }

  // --- Sync Orchestration Methods ---

  async sync() {
    consola.start(`Syncing products...`);

    // Fetch products from source shop with options
    const options = {};

    // If a specific handle was provided, use it for filtering
    if (this.options.handle) {
      consola.info(`Syncing only product with handle: ${this.options.handle}`);
      options.handle = this.options.handle;
    }

    const sourceProducts = await this.fetchProducts(this.sourceClient, this.options.limit, options);
    consola.info(`Found ${sourceProducts.length} product(s) in source shop`);

    const results = { created: 0, updated: 0, skipped: 0, failed: 0 };
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

      if (targetProduct) {
        // Update existing product - with bold/color highlighting
        consola.info(`\u001b[1m\u001b[36m◆ Updating product: ${product.title} (${product.handle})\u001b[0m`);
        const updated = await this.updateProduct(this.targetClient, product, targetProduct);

        // Log result with proper indentation
        if (updated) {
          consola.success(`  ✓ Product updated successfully`);
          results.updated++;
        } else {
          consola.error(`  ✖ Failed to update product`);
          results.failed++;
        }
      } else {
        // Create new product - with bold/color highlighting
        consola.info(`\u001b[1m\u001b[32m◆ Creating product: ${product.title} (${product.handle})\u001b[0m`);
        const created = await this.createProduct(this.targetClient, product);

        // Log result with proper indentation
        if (created) {
          consola.success(`  ✓ Product created successfully`);
          results.created++;
        } else {
          consola.error(`  ✖ Failed to create product`);
          results.failed++;
        }
      }

      processedCount++;
    }

    // Add a newline before summary
    consola.log('');
    consola.success(`Finished syncing products. Results: ${results.created} created, ${results.updated} updated, ${results.failed} failed`);
    return { definitionResults: results, dataResults: null };
  }
}

module.exports = ProductSyncStrategy;
