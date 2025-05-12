const logger = require("../utils/logger");
const { GetCollections, GetCollectionByHandle, CreateCollection, UpdateCollection } = require('../graphql');
const SyncResultTracker = require('../utils/SyncResultTracker');

class CollectionSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.resultTracker = new SyncResultTracker();
    this.targetChannels = null;
    this.targetPublications = null;
  }

  // --- Main Sync Method ---
  async sync() {
    logger.info(`Syncing collections...`);

    // Fetch collections from source and target shops
    const sourceCollections = await this._fetchSourceCollections();
    const targetCollections = await this.fetchCollections(this.targetClient, null);
    logger.info(`Found ${targetCollections.length} collection(s) in target shop`);

    const targetCollectionMap = this._buildTargetCollectionMap(targetCollections);

    // Fetch available channels and publications for the target store
    if (!this.options.skipPublications) {
      await this._fetchTargetPublicationData();
    }

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

  // --- Publication Methods ---
  async _fetchTargetPublicationData() {
    logger.info(`Fetching target store publication data...`);

    const getPublicationsQuery = `#graphql
      query GetPublicationsAndChannels {
        publications(first: 25) {
          edges {
            node {
              id
              name
              app {
                id
              }
            }
          }
        }
        channels(first: 25) {
          edges {
            node {
              id
              name
              handle
            }
          }
        }
      }
    `;

    try {
      const response = await this.targetClient.graphql(getPublicationsQuery, {}, 'GetPublicationsAndChannels');
      this.targetChannels = response.channels.edges.map(edge => edge.node);
      this.targetPublications = response.publications.edges.map(edge => edge.node);

      logger.info(`Found ${this.targetChannels.length} channels and ${this.targetPublications.length} publications in target store`);

      if (this.options.debug && this.targetChannels.length > 0) {
        logger.debug(`Available channels: ${this.targetChannels.map(c => c.handle).join(', ')}`);
      }
    } catch (error) {
      logger.error(`Error fetching publication data: ${error.message}`);
      this.targetChannels = [];
      this.targetPublications = [];
    }
  }

  async _syncCollectionPublications(collectionId, sourcePublications) {
    if (!sourcePublications || !this.targetChannels || !this.targetPublications) {
      return true; // Skip if no publication data available
    }

    // Extract publication data from collection
    let publicationsArray = [];
    if (sourcePublications.edges && Array.isArray(sourcePublications.edges)) {
      publicationsArray = sourcePublications.edges.map(edge => edge.node);
    }

    if (publicationsArray.length === 0) {
      logger.info(`No publication channels to sync for this collection`);
      return true;
    }

    // Filter out invalid publications (those without a valid channel.handle)
    const validPublications = publicationsArray.filter(pub =>
      pub && pub.channel && typeof pub.channel.handle === 'string' && pub.channel.handle.length > 0
    );

    if (validPublications.length === 0) {
      logger.info(`No valid publication channels found after filtering`);
      return true;
    }

    logger.info(`Syncing collection publication to ${validPublications.length} channels`);
    logger.indent();

    // Get current publications for this collection
    const getCollectionPublicationsQuery = `#graphql
      query GetCollectionPublications($collectionId: ID!) {
        collection(id: $collectionId) {
          publications(first: 25) {
            edges {
              node {
                channel {
                  id
                  handle
                }
                isPublished
              }
            }
          }
        }
      }
    `;

    let currentPublications = [];
    try {
      const response = await this.targetClient.graphql(
        getCollectionPublicationsQuery,
        { collectionId },
        'GetCollectionPublications'
      );

      if (response.collection && response.collection.publications) {
        currentPublications = response.collection.publications.edges.map(edge => edge.node);
      }

      if (this.options.debug) {
        logger.debug(`Collection is currently published to ${currentPublications.length} channels`);
      }
    } catch (error) {
      logger.warn(`Unable to fetch current publications: ${error.message}`);
      // Continue anyway since we can still try to publish
    }

    // Match source publications to target channels by handle
    const publicationsToCreate = [];
    const skippedChannels = [];
    const addedPublicationIds = new Set();

    // For each source publication
    for (const sourcePublication of validPublications) {
      // Only process publications that are actually published
      if (!sourcePublication.isPublished) continue;

      const sourceChannelHandle = sourcePublication.channel.handle;

      // Find matching target channel
      const targetChannel = this.targetChannels.find(channel => channel.handle === sourceChannelHandle);
      if (targetChannel) {
        // Find the publication associated with this channel - use first publication as default
        const targetPublication = this.targetPublications.length > 0 ? this.targetPublications[0] : null;

        if (targetPublication) {
          // Check if collection is already published to this channel
          const alreadyPublished = currentPublications.some(pub =>
            pub.channel.handle === sourceChannelHandle && pub.isPublished
          );

          // Check if we've already added this publication ID
          if (!alreadyPublished && !addedPublicationIds.has(targetPublication.id)) {
            publicationsToCreate.push({
              publicationId: targetPublication.id,
              channelHandle: sourceChannelHandle
            });
            // Mark this publication ID as added to avoid duplicates
            addedPublicationIds.add(targetPublication.id);
          } else if (this.options.debug) {
            if (alreadyPublished) {
              logger.debug(`Collection already published to ${sourceChannelHandle}`);
            } else {
              logger.debug(`Skipping duplicate publication ID for channel ${sourceChannelHandle}`);
            }
          }
        } else {
          logger.warn(`Found channel ${sourceChannelHandle} but no associated publication in target store`);
          skippedChannels.push(sourceChannelHandle);
        }
      } else {
        skippedChannels.push(sourceChannelHandle);
      }
    }

    // Log skipped channels
    if (skippedChannels.length > 0) {
      logger.warn(`Skipping ${skippedChannels.length} channels that don't exist in target store: ${skippedChannels.join(', ')}`);
    }

    // If no publications to create, we're done
    if (publicationsToCreate.length === 0) {
      logger.info(`No new publication channels to add`);
      logger.unindent();
      return true;
    }

    // Publish to target channels
    const publishMutation = `#graphql
      mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors {
            field
            message
          }
        }
      }
    `;

    if (this.options.notADrill) {
      try {
        logger.info(`Publishing collection to ${publicationsToCreate.length} channels`);

        const input = publicationsToCreate.map(pub => ({
          publicationId: pub.publicationId,
          publishDate: new Date().toISOString()
        }));

        const result = await this.targetClient.graphql(publishMutation, {
          id: collectionId,
          input
        }, 'PublishablePublish');

        if (result.publishablePublish.userErrors.length > 0) {
          logger.error(`Failed to publish collection:`, result.publishablePublish.userErrors);
          logger.unindent();
          return false;
        }

        logger.success(`Successfully published collection to ${publicationsToCreate.length} channels`);
        logger.unindent();
        return true;
      } catch (error) {
        logger.error(`Error publishing collection: ${error.message}`);
        logger.unindent();
        return false;
      }
    } else {
      logger.info(`[DRY RUN] Would publish collection to ${publicationsToCreate.length} channels: ${publicationsToCreate.map(p => p.channelHandle).join(', ')}`);
      logger.unindent();
      return true;
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

    let targetCollection;
    if (existingCollection) {
      targetCollection = await this._updateExistingCollection(collection, existingCollection);
    } else {
      targetCollection = await this._createNewCollection(collection);
    }

    // Sync publications if the collection was created/updated successfully and publications are not skipped
    if (targetCollection && !this.options.skipPublications) {
      await this._syncCollectionPublications(targetCollection.id, collection.publications);
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
    return updated;
  }

  async _createNewCollection(collection) {
    logger.info(`Creating collection: ${collection.title}`);
    const created = await this.createCollection(this.targetClient, collection);
    if (created) {
      this.resultTracker.trackCreation();
    } else {
      this.resultTracker.trackFailure();
    }
    return created;
  }

  _logOperationErrors(operation, collectionTitle, errors) {
    logger.error(`Failed to ${operation} collection "${collectionTitle}":`, errors);
  }
}

module.exports = CollectionSyncStrategy;
