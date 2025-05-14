const logger = require('../logger');
const FetchMetafieldDefinitionsQuery = require('../../graphql/FetchMetafieldDefinitions.graphql.js');

class CollectionMetafieldHandler {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.targetMetafieldDefinitions = {};
  }

  async fetchTargetMetafieldDefinitions(ownerType = "COLLECTION") {
    try {
      const response = await this.targetClient.graphql(
        FetchMetafieldDefinitionsQuery,
        { ownerType },
        'FetchMetafieldDefinitions'
      );

      const definitions = response.metafieldDefinitions.nodes;
      logger.info(`Found ${definitions.length} metafield definitions for ${ownerType} in target shop`);

      return definitions;
    } catch (error) {
      logger.error(`Error fetching metafield definitions: ${error.message}`);
      return [];
    }
  }

  async fetchAllTargetMetafieldDefinitions() {
    const metafieldDefinitions = {};

    // Common owner types that could be used in collections or metafield rules
    const allOwnerTypes = [
      "PRODUCT",
      "COLLECTION",
      "CUSTOMER",
      "ORDER",
      "PRODUCTVARIANT",
      "COMPANY",
      "COMPANY_LOCATION",
      "SHOP"
    ];

    logger.startSection('Pulling metafield definitions from target shop');

    for (const ownerType of allOwnerTypes) {
      metafieldDefinitions[ownerType] = await this.fetchTargetMetafieldDefinitions(ownerType);
    }

    logger.endSection();

    this.targetMetafieldDefinitions = metafieldDefinitions;
    return metafieldDefinitions;
  }

  async validateMetaobjectReferences(collection) {
    if (!collection.metafields || !collection.metafields.edges || collection.metafields.edges.length === 0) {
      return { valid: true };
    }

    for (const edge of collection.metafields.edges) {
      const node = edge.node;
      // Check if the metafield value is a metaobject reference
      if (node.value && node.value.includes('gid://shopify/Metaobject/')) {
        const metaobjectId = node.value;

        try {
          // Query the target store to check if this metaobject exists
          const response = await this.targetClient.graphql(`
            query CheckMetaobject($id: ID!) {
              node(id: $id) {
                id
                ... on Metaobject {
                  handle
                  type
                }
              }
            }
          `, { id: metaobjectId });

          if (!response.node) {
            // Get the metaobject details from source store for better error message
            const sourceResponse = await this.sourceClient.graphql(`
              query GetMetaobjectDetails($id: ID!) {
                node(id: $id) {
                  id
                  ... on Metaobject {
                    handle
                    type
                  }
                }
              }
            `, { id: metaobjectId });

            const metaobjectInfo = sourceResponse.node
              ? `type: ${sourceResponse.node.type}, handle: ${sourceResponse.node.handle}`
              : `ID: ${metaobjectId}`;

            return {
              valid: false,
              error: `Collection "${collection.title}" references a metaobject (${metaobjectInfo}) that doesn't exist in the target store. Sync the metaobjects first.`
            };
          }
        } catch (error) {
          logger.error(`Error validating metaobject reference: ${error.message}`);
          return {
            valid: false,
            error: `Failed to validate metaobject reference ${metaobjectId}: ${error.message}`
          };
        }
      }
    }

    return { valid: true };
  }

  async validateCollectionReferences(collection) {
    if (!collection.metafields || !collection.metafields.edges || collection.metafields.edges.length === 0) {
      return { valid: true, validMetafields: collection.metafields };
    }

    const validMetafieldEdges = [];
    const invalidCollectionRefs = [];

    for (const edge of collection.metafields.edges) {
      const node = edge.node;
      // Check if the metafield value is a collection reference
      if (node.value && node.value.includes('gid://shopify/Collection/')) {
        const collectionId = node.value;

        try {
          // Query the target store to check if this collection exists
          const response = await this.targetClient.graphql(`
            query CheckCollection($id: ID!) {
              node(id: $id) {
                id
                ... on Collection {
                  title
                }
              }
            }
          `, { id: collectionId });

          if (!response.node) {
            // Get the collection details from source store for better warning message
            let collectionInfo = collectionId;
            try {
              const sourceResponse = await this.sourceClient.graphql(`
                query GetCollectionDetails($id: ID!) {
                  node(id: $id) {
                    id
                    ... on Collection {
                      title
                    }
                  }
                }
              `, { id: collectionId });

              if (sourceResponse.node) {
                collectionInfo = `"${sourceResponse.node.title}" (${collectionId})`;
              }
            } catch (err) {
              // If we can't get source details, just use the ID
            }

            // Log a warning and don't include this metafield
            logger.warn(`Collection "${collection.title}" references collection ${collectionInfo} that doesn't exist in the target store. Removing this metafield reference.`);
            invalidCollectionRefs.push(`${node.namespace}.${node.key}`);
            continue;
          }
        } catch (error) {
          logger.warn(`Error validating collection reference: ${error.message}. Removing this metafield reference.`);
          invalidCollectionRefs.push(`${node.namespace}.${node.key}`);
          continue;
        }
      }

      // Add valid metafield to the list
      validMetafieldEdges.push(edge);
    }

    // Create a new metafields object with only valid references
    const validMetafields = {
      ...collection.metafields,
      edges: validMetafieldEdges
    };

    return {
      valid: true,
      validMetafields,
      invalidCollectionRefs
    };
  }

  async lookupMetafieldDefinitionIds(collection) {
    if (!collection.metafields || !collection.metafields.edges || collection.metafields.edges.length === 0) {
      return null;
    }

    // Validate any metaobject references first
    const metaobjectValidationResult = await this.validateMetaobjectReferences(collection);
    if (!metaobjectValidationResult.valid) {
      throw new Error(metaobjectValidationResult.error);
    }

    // Validate and filter out invalid collection references
    const collectionValidationResult = await this.validateCollectionReferences(collection);
    const validatedCollection = {
      ...collection,
      metafields: collectionValidationResult.validMetafields
    };

    // If all metafields were filtered out, return null
    if (validatedCollection.metafields.edges.length === 0) {
      return null;
    }

    // Always use COLLECTION owner type
    const ownerType = "COLLECTION";
    const targetDefinitions = await this.fetchTargetMetafieldDefinitions(ownerType);

    if (targetDefinitions.length === 0) {
      logger.warn(`No metafield definitions found for collections in target shop`);
      return null;
    }

    const metafieldLookup = {};

    for (const edge of validatedCollection.metafields.edges) {
      const node = edge.node;
      const key = `${node.namespace}.${node.key}`;

      const matchingDefinition = targetDefinitions.find(def =>
        def.namespace === node.namespace && def.key === node.key
      );

      if (matchingDefinition) {
        metafieldLookup[key] = matchingDefinition.id;
        logger.info(`Found definition ID for ${key}: ${matchingDefinition.id}`);
      } else {
        logger.info(`No definition found for ${key} in target shop`);
      }
    }

    return metafieldLookup;
  }

  // This method will be called directly before preparing metafields for API
  filterCollectionMetafields(metafields) {
    if (!metafields || !Array.isArray(metafields) || metafields.length === 0) {
      return [];
    }

    const filteredMetafields = [];

    for (const metafield of metafields) {
      // Filter out collection references
      if (metafield.value && typeof metafield.value === 'string' &&
          metafield.value.includes('gid://shopify/Collection/')) {
        logger.warn(`Filtering out collection reference in metafield ${metafield.namespace}.${metafield.key}: ${metafield.value}`);
        continue;
      }

      // Add valid metafield to the filtered list
      filteredMetafields.push(metafield);
    }

    if (filteredMetafields.length < metafields.length) {
      logger.info(`Removed ${metafields.length - filteredMetafields.length} collection references from metafields`);
    }

    return filteredMetafields;
  }

  getTargetMetafieldDefinitions() {
    return this.targetMetafieldDefinitions;
  }
}

module.exports = CollectionMetafieldHandler;
