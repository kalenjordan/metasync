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

  async lookupMetafieldDefinitionIds(collection) {
    if (!collection.metafields || !collection.metafields.edges || collection.metafields.edges.length === 0) {
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

    for (const edge of collection.metafields.edges) {
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

  getTargetMetafieldDefinitions() {
    return this.targetMetafieldDefinitions;
  }
}

module.exports = CollectionMetafieldHandler;
