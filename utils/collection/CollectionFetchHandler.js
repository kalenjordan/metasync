const logger = require('../logger');
const { GetCollections, GetCollectionByHandle } = require('../../graphql');

class CollectionFetchHandler {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
  }

  // --- Collection Fetch Methods ---
  async fetchCollections(client, limit = null) {
    let collections = [];
    let hasNextPage = true;
    let cursor = null;
    let totalFetched = 0;

    logger.info(`Fetching collections, please wait...`);

    while (hasNextPage) {
      const response = await client.graphql(
        GetCollections,
        { first: 100, after: cursor },
        'GetCollections'
      );

      const edges = response.collections.edges;
      collections = collections.concat(edges.map(edge => edge.node));
      totalFetched += edges.length;

      hasNextPage = response.collections.pageInfo.hasNextPage;
      cursor = response.collections.pageInfo.endCursor;

      // Break if we've reached the provided limit
      if (limit && collections.length >= limit) {
        collections = collections.slice(0, limit);
        break;
      }
    }

    return collections;
  }

  async getCollectionType(client, collectionId) {
    const smartQuery = `query: "id:${collectionId} AND collection_type:smart"`;
    const smartResponse = await client.graphql(
      GetCollections,
      { first: 1, query: smartQuery },
      'GetSmartCollection'
    );

    return smartResponse.collections.edges.length > 0 ? 'smart' : 'custom';
  }

  async getCollectionByHandle(client, handle) {
    const normalizedHandle = handle.trim().toLowerCase();
    const response = await client.graphql(
      GetCollectionByHandle,
      { handle: normalizedHandle },
      'GetCollectionByHandle'
    );
    return response.collectionByHandle;
  }

  async fetchSourceCollections() {
    // Check if a specific handle is provided
    if (this.options.handle) {
      const handle = this.options.handle.trim().toLowerCase();
      logger.info(`Fetching collection with handle "${handle}" from source shop`);

      const collection = await this.getCollectionByHandle(this.sourceClient, handle);
      if (collection) {
        logger.info(`Found collection: ${collection.title}`);
        return [collection];
      } else {
        logger.warn(`No collection found with handle "${handle}" in source shop`);
        return [];
      }
    }

    const limit = this.options.limit || 250;

    // If type option is provided, filter by collection type
    if (this.options.type) {
      const type = this.options.type.toLowerCase();
      if (type === 'manual' || type === 'custom') {
        // "manual" in our CLI maps to "custom" in Shopify's API
        return this.fetchCollectionsByType('custom', limit);
      } else if (type === 'smart') {
        return this.fetchCollectionsByType('smart', limit);
      } else {
        logger.warn(`Invalid collection type "${this.options.type}". Valid types are 'manual' or 'smart'.`);
      }
    }

    const collections = await this.fetchCollections(this.sourceClient, limit);
    logger.info(`Found ${collections.length} collection(s) in source shop`);
    return collections;
  }

  async fetchCollectionsByType(collectionType, limit) {
    const typeQuery = `collection_type:${collectionType}`;
    const response = await this.sourceClient.graphql(
      GetCollections,
      { first: limit, query: typeQuery },
      `Get${collectionType.charAt(0).toUpperCase() + collectionType.slice(1)}Collections`
    );

    const collections = response.collections.edges.map(edge => edge.node);
    logger.info(`Filtered to ${collections.length} ${collectionType} collection(s)`);
    return collections;
  }

  buildTargetCollectionMap(targetCollections) {
    const targetCollectionMap = {};

    for (const collection of targetCollections) {
      if (collection.handle) {
        const normalizedHandle = collection.handle.trim().toLowerCase();
        targetCollectionMap[normalizedHandle] = collection;
      }
    }

    return targetCollectionMap;
  }
}

module.exports = CollectionFetchHandler;
