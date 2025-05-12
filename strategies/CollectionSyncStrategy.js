const logger = require("../utils/logger");
const { GetCollections, GetCollectionByHandle, CreateCollection, UpdateCollection } = require('../graphql');

class CollectionSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.debug = options.debug;
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

      if (this.debug) {
        logger.debug(`Fetched ${edges.length} collections, total: ${totalFetched}`);
      }

      hasNextPage = response.collections.pageInfo.hasNextPage;
      cursor = response.collections.pageInfo.endCursor;

      // Break if we've reached the provided limit (for source shop)
      if (limit && collections.length >= limit) {
        collections = collections.slice(0, limit);
        break;
      }
    }

    return collections;
  }

  async getCollectionType(client, collectionId) {
    // Use a query to fetch smart collections
    const smartQuery = `query: "id:${collectionId} AND collection_type:smart"`;
    const smartResponse = await client.graphql(
      GetCollections,
      { first: 1, query: smartQuery },
      'GetSmartCollection'
    );

    // If we found a result, it's a smart collection
    if (smartResponse.collections.edges.length > 0) {
      return 'smart';
    }

    return 'custom';  // Default to custom if not found as smart
  }

  async getCollectionByHandle(client, handle) {
    // Normalize handle for consistency with GraphQL query
    const normalizedHandle = handle.trim().toLowerCase();

    const response = await client.graphql(
      GetCollectionByHandle,
      { handle: normalizedHandle },
      'GetCollectionByHandle'
    );
    return response.collectionByHandle;
  }

  // --- Collection Create/Update Methods ---

  async createCollection(client, collection) {
    const input = this._prepareCollectionInput(collection);

    if (this.options.notADrill) {
      // First, check if the collection already exists by handle
      const existingCollection = await this.getCollectionByHandle(client, collection.handle);

      if (existingCollection) {
        // Log with consistent message format
        logger.info(`Updating collection: ${collection.title}`);
        // If it exists, update it instead
        return this.updateCollection(client, collection, existingCollection);
      }

      // Otherwise, create the collection
      const result = await client.graphql(
        CreateCollection,
        { input },
        'CreateCollection'
      );

      if (result.collectionCreate.userErrors.length > 0) {
        logger.error(`Failed to create collection "${collection.title}":`, result.collectionCreate.userErrors);
        return null;
      }

      return result.collectionCreate.collection;
    } else {
      logger.info(`[DRY RUN] Would create collection "${collection.title}"`);
      return { id: "dry-run-id", title: collection.title, handle: collection.handle };
    }
  }

  async updateCollection(client, collection, existingCollection) {
    const input = this._prepareCollectionInput(collection);

    // Add the collection ID to the input
    input.id = existingCollection.id;

    if (this.options.notADrill) {
      const result = await client.graphql(
        UpdateCollection,
        { input },
        'UpdateCollection'
      );

      if (result.collectionUpdate.userErrors.length > 0) {
        logger.error(`Failed to update collection "${collection.title}":`, result.collectionUpdate.userErrors);
        return null;
      }

      return result.collectionUpdate.collection;
    } else {
      logger.info(`[DRY RUN] Would update collection "${collection.title}"`);
      return { id: existingCollection.id, title: collection.title, handle: collection.handle };
    }
  }

  // --- Helper Methods ---

  _prepareCollectionInput(collection) {
    // Extract collection properties for the input
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

    return input;
  }

  async _fetchSourceCollections() {
    const limit = this.options.limit || 250;

    // Check if skipAutomated flag is set
    if (this.options.skipAutomated) {
      const customQuery = 'collection_type:custom';
      const response = await this.sourceClient.graphql(
        GetCollections,
        { first: limit, query: customQuery },
        'GetCustomCollections'
      );

      const collections = response.collections.edges.map(edge => edge.node);
      logger.info(`Filtered to ${collections.length} manual/custom collection(s)`);
      return collections;
    }

    // Default: fetch all collections
    const collections = await this.fetchCollections(this.sourceClient, limit);
    logger.info(`Found ${collections.length} collection(s) in source shop`);
    return collections;
  }

  _buildTargetCollectionMap(targetCollections) {
    // Create map of target collections by handle for easy lookup
    // Normalize handles to lowercase and trim for case-insensitive comparison
    const targetCollectionMap = {};

    for (const collection of targetCollections) {
      if (collection.handle) {
        const normalizedHandle = collection.handle.trim().toLowerCase();
        targetCollectionMap[normalizedHandle] = collection;
      }
    }

    if (this.debug) {
      logger.debug(`Target collection map has ${Object.keys(targetCollectionMap).length} entries`);
      // Show a few example keys
      const mapKeys = Object.keys(targetCollectionMap).slice(0, 5);
      logger.debug(`Sample map keys: ${mapKeys.join(', ')}`);
    }

    return targetCollectionMap;
  }

  async _processCollection(collection, targetCollectionMap, results) {
    // Skip collections without a handle
    if (!collection.handle) {
      logger.warn(`Skipping collection with no handle: ${collection.title || 'Unnamed collection'}`);
      results.skipped++;
      return;
    }

    // Debug source collection info
    if (this.debug) {
      logger.debug(`Processing source collection: "${collection.title}" with handle: "${collection.handle}"`);
    }

    // Normalize handle for lookup consistently with how we normalized the map keys
    const normalizedHandle = collection.handle.trim().toLowerCase();

    // Check if the collection exists in target shop
    const existingCollection = targetCollectionMap[normalizedHandle];

    if (this.debug) {
      logger.debug(`Looking for handle "${normalizedHandle}" - ${existingCollection ? 'Found' : 'Not found'}`);
    }

    if (existingCollection) {
      // Update existing collection
      logger.info(`Updating collection: ${collection.title}`);
      const updated = await this.updateCollection(this.targetClient, collection, existingCollection);
      updated ? results.updated++ : results.failed++;
    } else {
      // Create new collection
      logger.info(`Creating collection: ${collection.title}`);
      const created = await this.createCollection(this.targetClient, collection);
      created ? results.created++ : results.failed++;
    }
  }

  // --- Sync Orchestration Method ---

  async sync() {
    logger.info(`Syncing collections...`);

    // Fetch collections from source and target shops
    const sourceCollections = await this._fetchSourceCollections();

    // Fetch ALL collections from target - no limit
    const targetCollections = await this.fetchCollections(this.targetClient, null);
    logger.info(`Found ${targetCollections.length} collection(s) in target shop`);

    // Debug info for target collections
    if (this.debug) {
      logger.debug(`First 5 target collections:`);
      targetCollections.slice(0, 5).forEach(collection => {
        logger.debug(`  - "${collection.title}" with handle: "${collection.handle}"`);
      });
    }

    const targetCollectionMap = this._buildTargetCollectionMap(targetCollections);

    const results = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let processedCount = 0;

    // Indent for collection processing
    logger.indent();

    // Process each source collection
    for (const collection of sourceCollections) {
      if (processedCount >= this.options.limit) {
        logger.info(`Reached processing limit (${this.options.limit}). Stopping collection sync.`);
        break;
      }

      await this._processCollection(collection, targetCollectionMap, results);
      processedCount++;
    }

    // Unindent after processing all collections
    logger.unindent();

    logger.success(`Finished syncing collections.`);
    logger.newline();

    return { definitionResults: results, dataResults: null };
  }
}

module.exports = CollectionSyncStrategy;
