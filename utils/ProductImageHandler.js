/**
 * Product Image Handler
 *
 * Handles image operations for Shopify products, including:
 * - Uploading images to products
 * - Associating images with variants
 * - Managing media attachments
 */
const consola = require('consola');
const ShopifyIDUtils = require('./ShopifyIDUtils');

class ProductImageHandler {
  constructor(client, options = {}) {
    this.client = client;
    this.options = options;
    this.debug = options.debug;
  }

  /**
   * Synchronize product images
   * @param {string} productId - The product ID
   * @param {Array} sourceImages - Array of image objects
   * @param {string} logPrefix - Prefix for logs
   * @returns {Promise<boolean>} - Success status
   */
  async syncProductImages(productId, sourceImages, logPrefix = '') {
    if (!sourceImages || sourceImages.length === 0) return true;

    consola.info(`${logPrefix}• Processing ${sourceImages.length} images for product`);

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
      const response = await this.client.graphql(existingImagesQuery, { productId }, 'GetProductMedia');
      existingImages = response.product.media.edges.map(edge => edge.node);
      consola.info(`${logPrefix}  - Found ${existingImages.length} existing images on product`);
    } catch (error) {
      consola.error(`${logPrefix}  ✖ Error fetching existing product images: ${error.message}`);
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
      consola.info(`${logPrefix}  - All images already exist on product, no need to upload`);
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
        consola.info(`${logPrefix}  - Uploading ${mediaInputs.length} new images for product`);
        const result = await this.client.graphql(createMediaMutation, {
          productId,
          media: mediaInputs
        }, 'ProductCreateMedia');

        if (result.productCreateMedia.userErrors.length > 0) {
          consola.error(`${logPrefix}  ✖ Failed to upload product images:`, result.productCreateMedia.userErrors);
          return false;
        } else {
          consola.success(`${logPrefix}  ✓ Successfully uploaded ${result.productCreateMedia.media.length} images`);
          return true;
        }
      } catch (error) {
        consola.error(`${logPrefix}  ✖ Error uploading product images: ${error.message}`);
        return false;
      }
    } else {
      consola.info(`${logPrefix}  - [DRY RUN] Would upload ${mediaInputs.length} new images for product`);
      for (const input of mediaInputs) {
        consola.info(`${logPrefix}    - [DRY RUN] Image: ${input.originalSource} (${input.alt || 'No alt text'})`);
      }
      return true;
    }
  }

  /**
   * Update variant image association
   * @param {string} variantId - Variant ID
   * @param {string} imageId - Image ID
   * @param {string} productId - Product ID
   * @param {string} logPrefix - Prefix for logs
   * @returns {Promise<boolean>} - Success status
   */
  async updateVariantImage(variantId, imageId, productId, logPrefix = '') {
    // Validate IDs
    if (!ShopifyIDUtils.isValidID(variantId) || !ShopifyIDUtils.isValidID(imageId)) {
      consola.error(`${logPrefix}✖ Invalid parameters: variantId or imageId is missing or invalid`);
      return false;
    }

    // Extract productId from variantId if not provided
    if (!productId) {
      productId = await ShopifyIDUtils.getProductIdFromVariantId(variantId, this.client);
      if (!productId) {
        consola.error(`${logPrefix}✖ Could not determine product ID for variant`);
        return false;
      }
    }

    // Validate we have a product ID
    if (!ShopifyIDUtils.isValidID(productId)) {
      consola.error(`${logPrefix}✖ Invalid product ID`);
      return false;
    }

    // Convert ProductImage ID to MediaImage ID if needed
    if (imageId.includes('ProductImage/')) {
      const mediaImageId = await ShopifyIDUtils.convertProductImageToMediaImage(imageId, productId, this.client);
      if (mediaImageId) {
        imageId = mediaImageId;
      } else {
        consola.error(`${logPrefix}✖ Could not find a MediaImage corresponding to ProductImage`);
        return false;
      }
    }

    // Confirm we now have a MediaImage ID
    if (!imageId.includes('MediaImage/')) {
      consola.error(`${logPrefix}✖ Unable to use image: ID is not a MediaImage ID`);
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

      const response = await this.client.graphql(checkVariantMediaQuery, { variantId }, 'checkVariantMedia');

      if (response.productVariant?.media?.nodes) {
        const existingMediaIds = response.productVariant.media.nodes.map(node => node.id);

        // If the variant already has this media attached, we can skip the operation
        if (existingMediaIds.includes(imageId)) {
          consola.info(`${logPrefix}- Variant already has the image attached, skipping`);
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
            const detachResult = await this.client.graphql(detachMediaMutation, {
              variantId,
              mediaIds: existingMediaIds
            }, 'productVariantDetachMedia');

            if (detachResult.productVariantDetachMedia.userErrors.length > 0) {
              consola.warn(`${logPrefix}⚠ Failed to detach existing media, but will continue with attach operation`);
            }
          } catch (error) {
            consola.warn(`${logPrefix}⚠ Error detaching media: ${error.message}, but will continue with attach operation`);
          }
        }
      }
    } catch (error) {
      consola.warn(`${logPrefix}⚠ Could not check existing variant media: ${error.message}, will continue anyway`);
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
        consola.info(`${logPrefix}- Updating variant image`);

        // Append the new media
        const result = await this.client.graphql(variantAppendMediaMutation, {
          productId: productId,
          variantMedia: [
            {
              variantId: variantId,
              mediaIds: [imageId]
            }
          ]
        }, 'productVariantAppendMedia');

        if (result.productVariantAppendMedia.userErrors.length > 0) {
          consola.error(`${logPrefix}✖ Failed to update variant image:`, result.productVariantAppendMedia.userErrors);
          return false;
        } else {
          consola.success(`${logPrefix}✓ Successfully updated variant image`);
          return true;
        }
      } catch (error) {
        consola.error(`${logPrefix}✖ Error updating variant image: ${error.message}`);
        return false;
      }
    } else {
      consola.info(`${logPrefix}- [DRY RUN] Would update variant image`);
      return true;
    }
  }
}

module.exports = ProductImageHandler;
