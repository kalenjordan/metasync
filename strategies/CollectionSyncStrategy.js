const logger = require("../utils/logger");
const { GetCollections, GetCollectionByHandle, CreateCollection, UpdateCollection } = require('../graphql');
const SyncResultTracker = require('../utils/SyncResultTracker');

class CollectionSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.resultTracker = new SyncResultTracker();
  }

  // --- Main Sync Method ---
  async sync() {
    logger.info(`Syncing collections...`);

    // Fetch collections from source and target shops
    const sourceCollections = await this._fetchSourceCollections();
    const targetCollections = await this.fetchCollections(this.targetClient, null);
    logger.info(`Found ${targetCollections.length} collection(s) in target shop`);

    const targetCollectionMap = this._buildTargetCollectionMap(targetCollections);

    // Process collections
    logger.indent();
    await this._processCollections(sourceCollections, targetCollectionMap);
    logger.unindent();

    logger.success(`Finished syncing collections.`);
    logger.newline();

    return this.resultTracker.formatForStrategyResult();
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

  // --- Collection Mutation Methods ---
  async createCollection(client, collection) {
    const input = this._prepareCollectionInput(collection);

    if (!this.options.notADrill) {
      logger.info(`[DRY RUN] Would create collection "${collection.title}"`);
      return { id: "dry-run-id", title: collection.title, handle: collection.handle };
    }

    try {
      const result = await client.graphql(
        CreateCollection,
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
        UpdateCollection,
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

  // --- Helper Methods ---
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

    // Add ruleSet if available (for smart collections)
    if (collection.ruleSet) {
      input.ruleSet = collection.ruleSet;
    }

    return input;
  }

  async _fetchSourceCollections() {
    const limit = this.options.limit || 250;

    if (this.options.skipAutomated) {
      return this._fetchCustomCollections(limit);
    }

    const collections = await this.fetchCollections(this.sourceClient, limit);
    logger.info(`Found ${collections.length} collection(s) in source shop`);
    return collections;
  }

  async _fetchCustomCollections(limit) {
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

  _buildTargetCollectionMap(targetCollections) {
    const targetCollectionMap = {};

    for (const collection of targetCollections) {
      if (collection.handle) {
        const normalizedHandle = collection.handle.trim().toLowerCase();
        targetCollectionMap[normalizedHandle] = collection;
      }
    }

    return targetCollectionMap;
  }

  async _processCollections(sourceCollections, targetCollectionMap) {
    let processedCount = 0;
    const limit = this.options.limit || Number.MAX_SAFE_INTEGER;

    for (const collection of sourceCollections) {
      if (processedCount >= limit) {
        logger.info(`Reached processing limit (${limit}). Stopping collection sync.`);
        break;
      }

      await this._processCollection(collection, targetCollectionMap);
      processedCount++;
    }
  }

  async _processCollection(collection, targetCollectionMap) {
    // Skip collections without a handle
    if (!collection.handle) {
      logger.warn(`Skipping collection with no handle: ${collection.title || 'Unnamed collection'}`);
      this.resultTracker.trackSkipped();
      return;
    }

    const normalizedHandle = collection.handle.trim().toLowerCase();
    const existingCollection = targetCollectionMap[normalizedHandle];

    if (existingCollection) {
      await this._updateExistingCollection(collection, existingCollection);
    } else {
      await this._createNewCollection(collection);
    }
  }

  async _updateExistingCollection(collection, existingCollection) {
    logger.info(`Updating collection: ${collection.title}`);
    const updated = await this.updateCollection(this.targetClient, collection, existingCollection);
    if (updated) {
      this.resultTracker.trackUpdate();
    } else {
      this.resultTracker.trackFailure();
    }
  }

  async _createNewCollection(collection) {
    logger.info(`Creating collection: ${collection.title}`);
    const created = await this.createCollection(this.targetClient, collection);
    if (created) {
      this.resultTracker.trackCreation();
    } else {
      this.resultTracker.trackFailure();
    }
  }

  _logOperationErrors(operation, collectionTitle, errors) {
    logger.error(`Failed to ${operation} collection "${collectionTitle}":`, errors);
  }
}

module.exports = CollectionSyncStrategy;
