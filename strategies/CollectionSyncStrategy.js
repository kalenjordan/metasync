const consola = require('consola');
const { GetCollections, GetCollectionByHandle, CreateCollection, UpdateCollection } = require('../graphql');

class CollectionSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.debug = options.debug;
  }

  // --- Collection Fetch Methods ---

  async fetchCollections(client, limit = 250) {
    try {
      let collections = [];
      let hasNextPage = true;
      let cursor = null;

      while (hasNextPage) {
        const response = await client.graphql(
          GetCollections,
          { first: 100, after: cursor },
          'GetCollections'
        );

        const edges = response.collections.edges;
        collections = collections.concat(edges.map(edge => edge.node));

        hasNextPage = response.collections.pageInfo.hasNextPage;
        cursor = response.collections.pageInfo.endCursor;

        // Break if we've reached the limit
        if (limit && collections.length >= limit) {
          collections = collections.slice(0, limit);
          break;
        }
      }

      return collections;
    } catch (error) {
      consola.error(`Error fetching collections: ${error.message}`);
      return [];
    }
  }

  // Additional method to determine if collection is smart or custom
  async getCollectionType(client, collectionId) {
    try {
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

      return 'custom';
    } catch (error) {
      consola.warn(`Error determining collection type: ${error.message}`);
      return 'custom';  // Default to custom if we can't determine
    }
  }

  async getCollectionByHandle(client, handle) {
    try {
      const response = await client.graphql(
        GetCollectionByHandle,
        { handle },
        'GetCollectionByHandle'
      );
      return response.collectionByHandle;
    } catch (error) {
      consola.error(`Error fetching collection with handle "${handle}": ${error.message}`);
      return null;
    }
  }

  // --- Collection Create/Update Methods ---

  async createCollection(client, collection) {
    const input = this._prepareCollectionInput(collection);

    if (this.options.notADrill) {
      try {
        const result = await client.graphql(
          CreateCollection,
          { input },
          'CreateCollection'
        );

        if (result.collectionCreate.userErrors.length > 0) {
          consola.error(`Failed to create collection "${collection.title}":`, result.collectionCreate.userErrors);
          return null;
        }

        return result.collectionCreate.collection;
      } catch (error) {
        consola.error(`Error creating collection "${collection.title}": ${error.message}`);
        return null;
      }
    } else {
      consola.info(`[DRY RUN] Would create collection "${collection.title}"`);
      return { id: "dry-run-id", title: collection.title, handle: collection.handle };
    }
  }

  async updateCollection(client, collection, existingCollection) {
    const input = this._prepareCollectionInput(collection);

    // Add the collection ID to the input
    input.id = existingCollection.id;

    if (this.options.notADrill) {
      try {
        const result = await client.graphql(
          UpdateCollection,
          { input },
          'UpdateCollection'
        );

        if (result.collectionUpdate.userErrors.length > 0) {
          consola.error(`Failed to update collection "${collection.title}":`, result.collectionUpdate.userErrors);
          return null;
        }

        return result.collectionUpdate.collection;
      } catch (error) {
        consola.error(`Error updating collection "${collection.title}": ${error.message}`);
        return null;
      }
    } else {
      consola.info(`[DRY RUN] Would update collection "${collection.title}"`);
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

  // --- Sync Orchestration Method ---

  async sync() {
    consola.start(`Syncing collections...`);

    // Fetch collections from source and target shops
    const limit = this.options.limit || 250;
    let sourceCollections = await this.fetchCollections(this.sourceClient, limit);
    consola.info(`Found ${sourceCollections.length} collection(s) in source shop`);

    // If skipAutomated is set, fetch only custom collections
    if (this.options.skipAutomated) {
      const customQuery = 'collection_type:custom';
      const response = await this.sourceClient.graphql(
        GetCollections,
        { first: limit, query: customQuery },
        'GetCustomCollections'
      );

      sourceCollections = response.collections.edges.map(edge => edge.node);
      consola.info(`Filtered to ${sourceCollections.length} manual/custom collection(s)`);
    }

    const targetCollections = await this.fetchCollections(this.targetClient);
    consola.info(`Found ${targetCollections.length} collection(s) in target shop`);

    // Create map of target collections by handle for easy lookup
    const targetCollectionMap = targetCollections.reduce((map, collection) => {
      if (collection.handle) {
        map[collection.handle] = collection;
      }
      return map;
    }, {});

    const results = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let processedCount = 0;

    // Process each source collection
    for (const collection of sourceCollections) {
      if (processedCount >= this.options.limit) {
        consola.info(`Reached processing limit (${this.options.limit}). Stopping collection sync.`);
        break;
      }

      if (collection.handle && targetCollectionMap[collection.handle]) {
        // Update existing collection
        consola.info(`Updating collection: ${collection.title}`);
        const updated = await this.updateCollection(this.targetClient, collection, targetCollectionMap[collection.handle]);
        updated ? results.updated++ : results.failed++;
      } else {
        // Create new collection
        consola.info(`Creating collection: ${collection.title}`);
        const created = await this.createCollection(this.targetClient, collection);
        created ? results.created++ : results.failed++;
      }

      processedCount++;
    }

    consola.success(`Finished syncing collections.`);
    return { definitionResults: results, dataResults: null };
  }
}

module.exports = CollectionSyncStrategy;
