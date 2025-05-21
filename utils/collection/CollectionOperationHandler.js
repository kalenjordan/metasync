const logger = require('../logger');
const {
  CollectionCreate,
  CollectionUpdate,
  CollectionDelete
} = require('../../graphql');

class CollectionOperationHandler {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.lastProcessedCollection = null;
    this.ruleSetHandler = null;
    this.targetMetafieldDefinitions = {};
    this.metafieldHandler = null;
  }

  setRuleSetHandler(ruleSetHandler) {
    this.ruleSetHandler = ruleSetHandler;
  }

  setMetafieldHandler(metafieldHandler) {
    this.metafieldHandler = metafieldHandler;
  }

  setTargetMetafieldDefinitions(targetMetafieldDefinitions) {
    this.targetMetafieldDefinitions = targetMetafieldDefinitions;
  }

  // --- Collection Mutation Methods ---
  async createCollection(client, collection) {
    // Validate metaobject references before creating
    const validationResult = await this._validateMetaobjectReferences(collection);
    if (!validationResult.valid) {
      logger.error(validationResult.error);
      return null;
    }

    const input = this._prepareCollectionInput(collection);

    if (!this.options.notADrill) {
      logger.info(`[DRY RUN] Would create collection "${collection.title}"`);
      return { id: "dry-run-id", title: collection.title, handle: collection.handle };
    }

    try {
      const result = await client.graphql(
        CollectionCreate,
        { input },
        'CreateCollection'
      );

      if (result.collectionCreate.userErrors.length > 0) {
        this._logOperationErrors('create', collection.title, result.collectionCreate.userErrors);
        return null;
      }

      return result.collectionCreate.collection;
    } catch (error) {
      logger.error(`Error creating collection "${collection.title}": ${error.message}`);
      return null;
    }
  }

  async updateCollection(client, collection, existingCollection) {
    // Validate metaobject references before updating
    const validationResult = await this._validateMetaobjectReferences(collection);
    if (!validationResult.valid) {
      logger.error(validationResult.error);
      return null;
    }

    // Check if source has a ruleSet but target doesn't
    if (collection.ruleSet && !existingCollection.ruleSet) {
      logger.error(`Cannot update collection "${collection.title}": Source has a ruleSet but target doesn't. Smart collections can't be converted from manual collections.`);
      return null;
    }

    const input = {
      ...this._prepareCollectionInput(collection),
      id: existingCollection.id
    };

    if (!this.options.notADrill) {
      logger.info(`[DRY RUN] Would update collection "${collection.title}"`);
      return { id: existingCollection.id, title: collection.title, handle: collection.handle };
    }

    try {
      const result = await client.graphql(
        CollectionUpdate,
        { input },
        'UpdateCollection'
      );

      if (result.collectionUpdate.userErrors.length > 0) {
        this._logOperationErrors('update', collection.title, result.collectionUpdate.userErrors);
        return null;
      }

      return result.collectionUpdate.collection;
    } catch (error) {
      logger.error(`Error updating collection "${collection.title}": ${error.message}`);
      return null;
    }
  }

  async deleteCollection(client, collectionId) {
    const input = {
      id: collectionId
    };

    if (!this.options.notADrill) {
      logger.info(`[DRY RUN] Would delete collection with ID "${collectionId}"`);
      return true;
    }

    try {
      const result = await client.graphql(
        CollectionDelete,
        { input },
        'DeleteCollection'
      );

      if (result.collectionDelete.userErrors.length > 0) {
        this._logOperationErrors('delete', collectionId, result.collectionDelete.userErrors);
        return false;
      }

      return !!result.collectionDelete.deletedCollectionId;
    } catch (error) {
      logger.error(`Error deleting collection with ID "${collectionId}": ${error.message}`);
      return false;
    }
  }

  // --- Helper Methods ---

  async _validateMetaobjectReferences(collection) {
    if (!collection.metafields || !collection.metafields.edges || collection.metafields.edges.length === 0) {
      return { valid: true };
    }

    logger.startSection(`Validating metaobject references for collection "${collection.title}"`);

    // Create a map to store source->target ID mappings
    this.metaobjectIdMap = {};

    for (const edge of collection.metafields.edges) {
      const node = edge.node;
      // Check if the metafield value might contain a metaobject reference
      if (node.value) {
        let metaobjectIds = [];

        try {
          // Check if value is a JSON string that might be an array
          if (node.value.startsWith('[') && node.value.includes('gid://shopify/Metaobject/')) {
            // Parse the JSON string to get the array
            const parsedValue = JSON.parse(node.value);
            if (Array.isArray(parsedValue)) {
              // Extract all metaobject IDs from the array
              metaobjectIds = parsedValue.filter(item =>
                typeof item === 'string' && item.includes('gid://shopify/Metaobject/')
              );
            }
          }
          // Handle direct metaobject reference (not in array)
          else if (typeof node.value === 'string' && node.value.includes('gid://shopify/Metaobject/')) {
            metaobjectIds = [node.value];
          }
        } catch (e) {
          logger.warn(`Could not parse metafield value: ${e.message}`);
          // If parsing fails, check if the raw string contains a metaobject reference
          if (typeof node.value === 'string' && node.value.includes('gid://shopify/Metaobject/')) {
            metaobjectIds = [node.value];
          }
        }

        // Validate each metaobject ID found
        for (const metaobjectId of metaobjectIds) {
          logger.startSection(`Validating metaobject reference: ${metaobjectId}`);

          try {
            // First, get the metaobject type and handle from the source store
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

            if (!sourceResponse.node) {
              logger.error(`Could not find metaobject with ID ${metaobjectId} in source store.`);
              logger.endSection();
              return {
                valid: false,
                error: `Collection "${collection.title}" references a metaobject (ID: ${metaobjectId}) that doesn't exist in the source store.`
              };
            }

            const metaobjectType = sourceResponse.node.type;
            const metaobjectHandle = sourceResponse.node.handle;

            logger.info(`Found metaobject in source: type=${metaobjectType}, handle=${metaobjectHandle}`);

            // Now check if a metaobject with the same type and handle exists in the target store
            const targetResponse = await this.targetClient.graphql(`
              query GetMetaobjectByTypeAndHandle($type: String!) {
                metaobjects(first: 1, type: $type, query: "handle:'${metaobjectHandle}'") {
                  edges {
                    node {
                      id
                      handle
                      type
                    }
                  }
                }
              }
            `, {
              type: metaobjectType,
            });

            const targetMetaobject = targetResponse.metaobjects?.edges?.[0]?.node;

            if (!targetMetaobject) {
              logger.endSection();
              return {
                valid: false,
                error: `Collection "${collection.title}" references a metaobject (type: ${metaobjectType}, handle: ${metaobjectHandle}) that doesn't exist in the target store. Sync the metaobjects first.`
              };
            } else {
              logger.info(`Metaobject exists in target store: ${targetMetaobject.type}/${targetMetaobject.handle} (ID: ${targetMetaobject.id})`);

              // Store mapping of source ID to target ID
              this.metaobjectIdMap[metaobjectId] = targetMetaobject.id;

              // Additional check to validate metaobject belongs to correct definition
              const metafieldDefinition = node.definition;
              if (metafieldDefinition && metafieldDefinition.validations) {
                const validations = typeof metafieldDefinition.validations === 'string'
                  ? JSON.parse(metafieldDefinition.validations)
                  : metafieldDefinition.validations;

                // Check if there's a metaobject_definition validation
                if (validations.metaobject_definition) {
                  const requiredDefinitionId = validations.metaobject_definition;

                  // Check if the metaobject belongs to the correct definition
                  const metaobjectTypeResponse = await this.sourceClient.graphql(`
                    query GetMetaobjectType($id: ID!) {
                      node(id: $id) {
                        id
                        ... on Metaobject {
                          definition {
                            id
                          }
                        }
                      }
                    }
                  `, { id: metaobjectId });

                  if (metaobjectTypeResponse.node &&
                      metaobjectTypeResponse.node.definition &&
                      metaobjectTypeResponse.node.definition.id !== requiredDefinitionId) {
                    logger.endSection();
                    return {
                      valid: false,
                      error: `Metaobject ${metaobjectId} doesn't belong to the required definition ${requiredDefinitionId}`
                    };
                  }
                }
              }
            }
          } catch (error) {
            logger.error(`Error validating metaobject reference: ${error.message}`);
            logger.endSection();
            return {
              valid: false,
              error: `Failed to validate metaobject reference ${metaobjectId}: ${error.message}`
            };
          }

          logger.endSection();
        }
      }
    }

    logger.endSection();
    return { valid: true };
  }

  _prepareCollectionInput(collection) {
    const input = {
      title: collection.title,
      handle: collection.handle,
      descriptionHtml: collection.descriptionHtml,
      templateSuffix: collection.templateSuffix,
      sortOrder: collection.sortOrder
    };

    // Add SEO if available
    if (collection.seo) {
      input.seo = {
        title: collection.seo.title,
        description: collection.seo.description
      };
    }

    // Add image if available
    if (collection.image && collection.image.url) {
      input.image = {
        altText: collection.image.altText || collection.title,
        src: collection.image.url
      };
    }

    // Process ruleset using the handler
    if (collection.ruleSet && collection.ruleSet.rules && this.ruleSetHandler) {
      // Analyze and log ruleset details
      this.ruleSetHandler.analyzeRuleSet(collection);

      // Prepare rules with conditionObjectId for metafield conditions
      input.ruleSet = this.ruleSetHandler.prepareRuleSetInput(collection);
    }

    // Add metafields if available
    if (collection.metafields && collection.metafields.edges && collection.metafields.edges.length > 0) {
      // In Shopify API Collection Input requires specific metafield format
      logger.info(`Preparing ${collection.metafields.edges.length} metafields for collection "${collection.title}"`);

      let metafieldsArray = collection.metafields.edges.map(edge => {
        const node = edge.node;

        if (!node.definition) {
          logger.error(`Missing definition in metafield ${node.namespace}.${node.key}`);
          return null;
        }

        const definitionId = node.definition.id || null;
        if (!node.definition.ownerType) {
          logger.error(`Missing ownerType in metafield definition for ${node.namespace}.${node.key}`);
          return null;
        }

        // Look for matching definition in target by namespace/key
        if (!this.targetMetafieldDefinitions[node.definition.ownerType]) {
          logger.error(`No metafield definitions found for owner type: ${node.definition.ownerType}`);
          return null;
        }

        const matchingDef = this.targetMetafieldDefinitions[node.definition.ownerType].find(targetDef =>
          targetDef.namespace === node.namespace && targetDef.key === node.key
        );

        if (matchingDef) {
          let value = node.value;

          // Replace metaobject references with target IDs
          if (this.metaobjectIdMap && Object.keys(this.metaobjectIdMap).length > 0) {
            // Check if value contains metaobject references
            if (value && typeof value === 'string') {
              // Handle array of references (JSON string)
              if (value.startsWith('[') && value.includes('gid://shopify/Metaobject/')) {
                try {
                  const parsedValue = JSON.parse(value);
                  if (Array.isArray(parsedValue)) {
                    // Replace each ID in the array
                    const updatedValue = parsedValue.map(item => {
                      if (typeof item === 'string' && item.includes('gid://shopify/Metaobject/') && this.metaobjectIdMap[item]) {
                        return this.metaobjectIdMap[item];
                      }
                      return item;
                    });
                    value = JSON.stringify(updatedValue);
                    logger.info(`Replaced metaobject IDs in array for ${node.namespace}.${node.key}`);
                  }
                } catch (e) {
                  logger.warn(`Could not parse JSON array in metafield ${node.namespace}.${node.key}: ${e.message}`);
                }
              }
              // Handle single reference
              else if (value.includes('gid://shopify/Metaobject/')) {
                if (this.metaobjectIdMap[value]) {
                  value = this.metaobjectIdMap[value];
                  logger.info(`Replaced metaobject ID ${node.value} with ${value} for ${node.namespace}.${node.key}`);
                }
              }
            }
          }

          // Fix: Use key/namespace/value format instead of definitionId
          return {
            key: node.key,
            namespace: node.namespace,
            value: value,
            type: matchingDef.type ? matchingDef.type.name : "string"
          };
        } else {
          logger.error(`No matching metafield definition found for ${node.namespace}.${node.key} with ownerType=${node.definition.ownerType}`);
          return null;
        }
      }).filter(Boolean);

      // Filter out any metafields that reference collections
      if (this.metafieldHandler) {
        const originalCount = metafieldsArray.length;
        metafieldsArray = this.metafieldHandler.filterCollectionMetafields(metafieldsArray);
        if (metafieldsArray.length < originalCount) {
          logger.info(`After filtering collection references: ${metafieldsArray.length} metafields remaining for collection "${collection.title}"`);
        }
      }

      input.metafields = metafieldsArray;
    }

    return input;
  }

  _logOperationErrors(operation, collectionTitle, errors) {
    logger.startSection(`Failed to ${operation} collection "${collectionTitle}":`);

    // Check for metafield definition errors
    const metafieldErrors = errors.filter(err =>
      err.message && (
        err.message.includes('metafield definition') ||
        err.message.includes('The metafield definition')
      )
    );

    if (metafieldErrors.length > 0) {
      logger.startSection(`Metafield Definition Errors:`);

      // If collection has metafields, try to log which one is causing problems
      if (this.lastProcessedCollection && this.lastProcessedCollection.metafields) {
        const metafields = this.lastProcessedCollection.metafields.edges
          ? this.lastProcessedCollection.metafields.edges.map(edge => edge.node)
          : this.lastProcessedCollection.metafields;

        logger.startSection(`Collection has the following metafields:`);

        metafields.forEach(metafield => {
          if (metafield.namespace && metafield.key) {
            const ownerType = metafield.definition?.ownerType || "UNKNOWN";
            logger.error(`- ${metafield.namespace}.${metafield.key} (Type: ${metafield.type || 'unknown type'}, Owner Type: ${ownerType})`);
          }
        });

        logger.endSection();

        // Check for metafield conditions in rule set
        if (this.lastProcessedCollection.ruleSet && this.lastProcessedCollection.ruleSet.rules && this.ruleSetHandler) {
          // Log information about ruleset errors using the handler
          this.ruleSetHandler.logRuleErrors(this.lastProcessedCollection);
        }
      } else {
        logger.error(`Could not find metafield information for this collection.`);
      }

      logger.endSection();
    }

    // Log errors with proper formatting
    logger.startSection(`API Errors:`);

    errors.forEach(err => {
      if (err.field) {
        logger.error(`Field: ${err.field}, Message: ${err.message}`);
      } else if (err.message) {
        logger.error(`Message: ${err.message}`);
      } else {
        // Fallback if error structure is unexpected
        logger.error(JSON.stringify(err, null, 2));
      }
    });

    logger.endSection();
    logger.endSection();
  }

  prepareMetafields(collection) {
    const metafields = collection.metafields?.edges;
    if (!metafields || metafields.length === 0) return;

    // Just log the count instead of each metafield's details
    logger.info(`Processing ${metafields.length} metafields for collection`);

    // Still need to check for matching definitions but without verbose logging
    metafields.forEach(edge => {
      const m = edge.node;
      const ownerType = m.definition?.ownerType || 'UNKNOWN';

      if (!m.definition) {
        logger.error(`No definition attached to metafield ${m.namespace}.${m.key}`);
        return;
      }

      if (!m.definition.ownerType) {
        logger.error(`Missing ownerType in metafield definition for ${m.namespace}.${m.key}`);
        return;
      }

      // Check for matching definition
      if (!this.targetMetafieldDefinitions[ownerType]) {
        logger.error(`No metafield definitions found for owner type: ${ownerType}`);
        return;
      }

      const matchingDef = this.targetMetafieldDefinitions[ownerType].find(targetDef =>
        targetDef.namespace === m.namespace && targetDef.key === m.key
      );

      if (!matchingDef) {
        logger.error(`No matching metafield definition found for ${m.namespace}.${m.key} with ownerType=${ownerType}`);
      }
    });
  }

  setLastProcessedCollection(collection) {
    this.lastProcessedCollection = collection;
  }
}

module.exports = CollectionOperationHandler;
