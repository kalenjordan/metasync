/**
 * Metafield Reference Handler
 *
 * This utility class handles the transformation of reference metafields
 * between Shopify stores, including:
 * - Collection references (single and list)
 * - Variant references (single and list)
 * - Product references (single and list)
 * - And other reference types as needed
 */
const LoggingUtils = require('./LoggingUtils');

class MetafieldReferenceHandler {
  constructor(sourceClient, targetClient, options = {}, dependencies = {}) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.debug = options.debug;

    // Store dependencies like other handlers
    this.variantHandler = dependencies.variantHandler;
    this.collectionHandler = dependencies.collectionHandler;
    this.productHandler = dependencies.productHandler;
  }

  /**
   * Transform all reference metafields in a list
   * @param {Array} metafields - List of metafields that may contain references
   * @returns {Promise<Object>} - Object with transformed metafields and error stats
   */
  async transformReferences(metafields) {
    if (!metafields || metafields.length === 0) {
      return {
        transformedMetafields: [],
        stats: { processed: 0, transformed: 0, blanked: 0, errors: 0, warnings: 0 }
      };
    }

    const transformedMetafields = [];
    const stats = {
      processed: metafields.length,
      transformed: 0,
      blanked: 0,
      errors: 0,
      warnings: 0,
      unsupportedTypes: new Set(), // Track unique unsupported types
      byType: {
        regular: 0,
        references: {
          collection: 0,
          variant: 0,
          product: 0,
          unsupported: 0
        },
        lists: {
          collection: 0,
          variant: 0,
          product: 0,
          unsupported: 0
        }
      }
    };

    LoggingUtils.info(`Starting reference transformation for ${metafields.length} metafields`, 2, 'main');

    for (const metafield of metafields) {
      // Skip if no type (shouldn't happen)
      if (!metafield.type) {
        transformedMetafields.push(metafield);
        continue;
      }

      // Check if it's a reference type
      if (!metafield.type.includes('reference')) {
        transformedMetafields.push(metafield);
        stats.byType.regular++;
        stats.transformed++;
        continue;
      }

      // Is this a single reference or a list?
      const isList = metafield.type.startsWith('list.');
      // Get reference type by removing 'list.' prefix if present
      const refType = isList ? metafield.type.substring(5) : metafield.type;

      try {
        let transformedMetafield = null;
        let isUnsupportedType = false;

        // Transform based on reference type
        switch (refType) {
          case 'collection_reference':
            transformedMetafield = isList
              ? await this.transformListReference('collection', metafield)
              : await this.transformSingleReference('collection', metafield);

            if (transformedMetafield) {
              if (isList) stats.byType.lists.collection++;
              else stats.byType.references.collection++;
              stats.transformed++;
            }
            break;

          case 'variant_reference':
            transformedMetafield = isList
              ? await this.transformListReference('variant', metafield)
              : await this.transformSingleReference('variant', metafield);

            if (transformedMetafield) {
              if (isList) stats.byType.lists.variant++;
              else stats.byType.references.variant++;
              stats.transformed++;
            }
            break;

          case 'product_reference':
            transformedMetafield = isList
              ? await this.transformListReference('product', metafield)
              : await this.transformSingleReference('product', metafield);

            if (transformedMetafield) {
              if (isList) stats.byType.lists.product++;
              else stats.byType.references.product++;
              stats.transformed++;
            }
            break;

          default:
            // Unknown/unsupported reference type - track as a warning
            isUnsupportedType = true;
            stats.unsupportedTypes.add(refType);
            stats.warnings++;
            if (isList) stats.byType.lists.unsupported++;
            else stats.byType.references.unsupported++;

            LoggingUtils.warn(`Unsupported reference type: ${refType} for ${metafield.namespace}.${metafield.key} - keeping original value`, 3);
            transformedMetafield = metafield;
            stats.transformed++;
            break;
        }

        if (transformedMetafield) {
          // Add flag for unsupported types for tracking
          if (isUnsupportedType) {
            transformedMetafield._unsupportedType = true;
          }
          transformedMetafields.push(transformedMetafield);
        } else {
          stats.blanked++;
          stats.errors++;
          // Create a blanked metafield instead of keeping the original value
          const blankedMetafield = this.createBlankedMetafield(metafield);
          LoggingUtils.warn(`Transformation failed for ${metafield.namespace}.${metafield.key}, blanking the value`, 6);
          transformedMetafields.push(blankedMetafield);
        }
      } catch (error) {
        LoggingUtils.error(`Error transforming reference ${metafield.namespace}.${metafield.key}: ${error.message}`, 6);
        stats.blanked++;
        stats.errors++;
        // Create a blanked metafield instead of keeping the original
        const blankedMetafield = this.createBlankedMetafield(metafield);
        transformedMetafields.push(blankedMetafield);
      }
    }

    // Log transformation summary
    const refCount = Object.values(stats.byType.references).reduce((sum, val) => sum + val, 0);
    const listCount = Object.values(stats.byType.lists).reduce((sum, val) => sum + val, 0);
    const unsupportedCount = stats.byType.references.unsupported + stats.byType.lists.unsupported;

    LoggingUtils.info(
      `Reference transformation complete: ${stats.byType.regular} regular, ` +
      `${refCount} single references, ${listCount} list references, ` +
      `${stats.blanked} blanked due to errors, ${unsupportedCount} unsupported types`, 3);

    return {
      transformedMetafields,
      stats: {
        processed: stats.processed,
        transformed: stats.transformed,
        blanked: stats.blanked,
        errors: stats.errors,
        warnings: stats.warnings,
        unsupportedTypes: Array.from(stats.unsupportedTypes)
      }
    };
  }

  /**
   * Create a blanked version of a metafield when transformation fails
   * @param {Object} metafield - Original metafield
   * @returns {Object} - New metafield with blanked value
   */
  createBlankedMetafield(metafield) {
    // Create a copy of the metafield with a blank value
    const blankedMetafield = { ...metafield };

    // Different blank value based on type
    if (metafield.type.startsWith('list.')) {
      // For list types, use an empty array
      blankedMetafield.value = '[]';
    } else if (metafield.type === 'boolean' || metafield.type === 'number') {
      // For these types, we can't use empty string, so omit the value
      // The metafield will be skipped during creation
      delete blankedMetafield.value;
    } else {
      // For string and other types, use empty string
      blankedMetafield.value = '';
    }

    // Add a flag to indicate this was blanked
    blankedMetafield._blanked = true;

    return blankedMetafield;
  }

  /**
   * Transform a single reference metafield
   * @param {String} refType - The reference type (collection, variant, product)
   * @param {Object} metafield - The metafield to transform
   * @returns {Promise<Object|null>} - Transformed metafield or null if failed
   */
  async transformSingleReference(refType, metafield) {
    try {
      const sourceId = metafield.value;
      let sourceObject, sourceIdentifier, targetObject, targetId;

      switch (refType) {
        case 'collection':
          // For collections, we use handle as the identifier
          sourceObject = await this.getCollectionById(this.sourceClient, sourceId);
          if (!sourceObject) return null;

          sourceIdentifier = sourceObject.handle;
          LoggingUtils.info(`Found source collection handle: ${sourceIdentifier}`, 6);

          targetObject = await this.getCollectionByHandle(this.targetClient, sourceIdentifier);
          break;

        case 'variant':
          // For variants, first try to match by SKU if possible, otherwise use product handle + options
          sourceObject = await this.variantHandler.getVariantWithProductInfo(this.sourceClient, sourceId);
          if (!sourceObject) {
            LoggingUtils.error(`Could not find source variant with ID: ${sourceId}`, 6);
            return null;
          }

          // If we have a SKU, try to match by that first
          if (sourceObject.sku) {
            sourceIdentifier = sourceObject.sku;
            LoggingUtils.info(`Found source variant SKU: ${sourceIdentifier}`, 6);

            targetObject = await this.variantHandler.getVariantBySku(this.targetClient, sourceIdentifier);

            // If we found a match by SKU, don't need to try other methods
            if (targetObject) {
              break;
            }
            LoggingUtils.info(`Could not find target variant with SKU: ${sourceIdentifier}, trying to match by options`, 6);
          }

          // If no SKU or no match found, try by product handle + options
          if (sourceObject.product && sourceObject.product.handle && sourceObject.selectedOptions) {
            LoggingUtils.info(`Attempting to match variant by product handle: ${sourceObject.product.handle} and options`, 6);

            // Use the product handle and option values to find the variant
            targetObject = await this.variantHandler.getVariantByOptions(
              this.targetClient,
              sourceObject.product.handle,
              sourceObject.selectedOptions
            );
          }
          break;

        case 'product':
          // For products, we use handle as the identifier
          sourceObject = await this.getProductById(this.sourceClient, sourceId);
          if (!sourceObject) return null;

          sourceIdentifier = sourceObject.handle;
          LoggingUtils.info(`Found source product handle: ${sourceIdentifier}`, 6);

          targetObject = await this.getProductByHandle(this.targetClient, sourceIdentifier);
          break;

        default:
          LoggingUtils.error(`Unsupported reference type: ${refType}`, 6);
          return null;
      }

      if (!targetObject) {
        LoggingUtils.error(`Could not find target ${refType} for source ID: ${sourceId}`, 6);
        return null;
      }

      targetId = targetObject.id;
      LoggingUtils.info(`Found target ${refType} ID: ${targetId}`, 6);

      // Return the transformed metafield with the target ID
      return {
        ...metafield,
        value: targetId
      };
    } catch (error) {
      LoggingUtils.error(`Error transforming ${refType} reference: ${error.message}`, 6);
      return null;
    }
  }

  /**
   * Transform a list of references metafield
   * @param {String} refType - The reference type (collection, variant, product)
   * @param {Object} metafield - The metafield containing a list of references
   * @returns {Promise<Object|null>} - Transformed metafield or null if failed
   */
  async transformListReference(refType, metafield) {
    try {
      // Parse the JSON array of IDs
      const sourceIds = JSON.parse(metafield.value);
      LoggingUtils.info(`Found ${sourceIds.length} source ${refType} IDs in list`, 6);

      const targetIds = [];

      for (const sourceId of sourceIds) {
        let sourceObject, sourceIdentifier, targetObject;

        switch (refType) {
          case 'collection':
            // For collections, we use handle as the identifier
            sourceObject = await this.getCollectionById(this.sourceClient, sourceId);
            if (!sourceObject) continue;

            sourceIdentifier = sourceObject.handle;
            LoggingUtils.info(`Found source collection handle: ${sourceIdentifier} for ID: ${sourceId}`, 7);

            targetObject = await this.getCollectionByHandle(this.targetClient, sourceIdentifier);
            break;

          case 'variant':
            // For variants, try SKU first, then product handle + options
            sourceObject = await this.variantHandler.getVariantWithProductInfo(this.sourceClient, sourceId);
            if (!sourceObject) {
              LoggingUtils.error(`Could not find source variant with ID: ${sourceId}`, 7);
              continue;
            }

            // If we have a SKU, try to match by that first
            if (sourceObject.sku) {
              sourceIdentifier = sourceObject.sku;
              LoggingUtils.info(`Found source variant SKU: ${sourceIdentifier} for ID: ${sourceId}`, 7);

              targetObject = await this.variantHandler.getVariantBySku(this.targetClient, sourceIdentifier);

              // If we found a match by SKU, don't need to try other methods
              if (targetObject) {
                break;
              }
              LoggingUtils.info(`Could not find target variant with SKU: ${sourceIdentifier}, trying to match by options`, 7);
            }

            // If no SKU or no match found, try by product handle + options
            if (sourceObject.product && sourceObject.product.handle && sourceObject.selectedOptions) {
              LoggingUtils.info(`Attempting to match variant by product handle: ${sourceObject.product.handle} and options for ID: ${sourceId}`, 7);

              // Use the product handle and option values to find the variant
              targetObject = await this.variantHandler.getVariantByOptions(
                this.targetClient,
                sourceObject.product.handle,
                sourceObject.selectedOptions
              );
            }
            break;

          case 'product':
            // For products, we use handle as the identifier
            sourceObject = await this.getProductById(this.sourceClient, sourceId);
            if (!sourceObject) continue;

            sourceIdentifier = sourceObject.handle;
            LoggingUtils.info(`Found source product handle: ${sourceIdentifier} for ID: ${sourceId}`, 7);

            targetObject = await this.getProductByHandle(this.targetClient, sourceIdentifier);
            break;

          default:
            LoggingUtils.error(`Unsupported reference type: ${refType}`, 7);
            continue;
        }

        if (!targetObject) {
          LoggingUtils.error(`Could not find target ${refType} for source ID: ${sourceId}`, 7);
          continue;
        }

        const targetId = targetObject.id;
        LoggingUtils.info(`Found target ${refType} ID: ${targetId} for source ID: ${sourceId}`, 7);
        targetIds.push(targetId);
      }

      if (targetIds.length > 0) {
        const transformedValue = JSON.stringify(targetIds);
        return {
          ...metafield,
          value: transformedValue
        };
      } else {
        LoggingUtils.error(`Failed to transform any ${refType}s in list metafield: ${metafield.namespace}.${metafield.key}`, 6);
        return null;
      }
    } catch (error) {
      LoggingUtils.error(`Error transforming ${refType} reference list: ${error.message}`, 6);
      return null;
    }
  }

  // Helper methods for fetching resources

  async getCollectionById(client, id) {
    if (!this.collectionHandler) {
      const query = `#graphql
        query GetCollectionById($id: ID!) {
          collection(id: $id) {
            id
            handle
            title
          }
        }
      `;

      try {
        const response = await client.graphql(query, { id }, 'GetCollectionById');
        return response.collection;
      } catch (error) {
        LoggingUtils.error(`Could not find collection for ID: ${id}`, 6);
        return null;
      }
    } else {
      return await this.collectionHandler.getCollectionById(client, id);
    }
  }

  async getCollectionByHandle(client, handle) {
    if (!this.collectionHandler) {
      const query = `#graphql
        query GetCollectionByHandle($handle: String!) {
          collectionByHandle(handle: $handle) {
            id
            handle
            title
          }
        }
      `;

      try {
        const response = await client.graphql(query, { handle }, 'GetCollectionByHandle');
        return response.collectionByHandle;
      } catch (error) {
        LoggingUtils.error(`Error fetching collection by handle: ${error.message}`, 6);
        return null;
      }
    } else {
      return await this.collectionHandler.getCollectionByHandle(client, handle);
    }
  }

  async getProductById(client, id) {
    if (!this.productHandler) {
      const query = `#graphql
        query GetProductById($id: ID!) {
          product(id: $id) {
            id
            handle
            title
          }
        }
      `;

      try {
        const response = await client.graphql(query, { id }, 'GetProductById');
        return response.product;
      } catch (error) {
        LoggingUtils.error(`Could not find product for ID: ${id}`, 6);
        return null;
      }
    } else {
      return await this.productHandler.getProductById(client, id);
    }
  }

  async getProductByHandle(client, handle) {
    if (!this.productHandler) {
      const query = `#graphql
        query GetProductByHandle($handle: String!) {
          productByHandle(handle: $handle) {
            id
            handle
            title
          }
        }
      `;

      try {
        const response = await client.graphql(query, { handle }, 'GetProductByHandle');
        return response.productByHandle;
      } catch (error) {
        LoggingUtils.error(`Error fetching product by handle: ${error.message}`, 6);
        return null;
      }
    } else {
      return await this.productHandler.getProductByHandle(client, handle);
    }
  }
}

module.exports = MetafieldReferenceHandler;
