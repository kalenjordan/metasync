const logger = require("./logger");
/**
 * Shopify ID Utilities
 *
 * Handles various operations related to Shopify IDs, including:
 * - Validation
 * - Type checking
 * - URL normalization
 * - ID extraction and conversion
 */

class ShopifyIDUtils {
  /**
   * Check if a string is a valid Shopify ID (starts with gid://)
   * @param {string} id - The ID to validate
   * @returns {boolean} - Whether the ID is valid
   */
  static isValidID(id) {
    return typeof id === 'string' && id.startsWith('gid://');
  }

  /**
   * Extract the ID type from a Shopify ID
   * @param {string} id - The ID to analyze
   * @returns {string|null} - The ID type or null if invalid
   */
  static getIDType(id) {
    if (!this.isValidID(id)) return null;

    // Format is gid://shopify/Type/12345
    const parts = id.split('/');
    if (parts.length >= 4) {
      return parts[3];
    }

    return null;
  }

  /**
   * Check if ID is of a specific type
   * @param {string} id - The ID to check
   * @param {string} type - The type to check for
   * @returns {boolean} - Whether the ID is of the specified type
   */
  static isIDType(id, type) {
    return this.getIDType(id) === type;
  }

  /**
   * Normalize a URL for comparison
   * @param {string} url - URL to normalize
   * @returns {string} - Normalized URL
   */
  static normalizeUrl(url) {
    if (!url) return '';
    // Remove protocol, query params, and normalize to lowercase
    return url.replace(/^https?:\/\//, '')
              .split('?')[0]
              .toLowerCase();
  }

  /**
   * Extract product ID from a variant ID
   * @param {string} variantId - Variant ID
   * @param {object} client - Shopify client
   * @returns {Promise<string|null>} - Product ID or null if not found
   */
  static async getProductIdFromVariantId(variantId, client) {
    if (!this.isValidID(variantId)) return null;

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
      return response.productVariant.product.id;
    } catch (error) {
      console.error(`Could not determine product ID for variant: ${error.message}`);
      return null;
    }
  }

  /**
   * Convert a ProductImage ID to a MediaImage ID
   * @param {string} imageId - The ProductImage ID
   * @param {string} productId - The product ID
   * @param {object} client - Shopify client
   * @returns {Promise<string|null>} - MediaImage ID or null if not found
   */
  static async convertProductImageToMediaImage(imageId, productId, client) {
    if (!this.isValidID(imageId) || !this.isValidID(productId)) return null;

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
        return foundMediaId;
      }

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
          return foundMediaId;
        }
      }

      return null;
    } catch (error) {
      console.error(`Error converting ProductImage to MediaImage: ${error.message}`);
      return null;
    }
  }
}

module.exports = ShopifyIDUtils;
