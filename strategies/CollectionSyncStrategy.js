const logger = require("../utils/logger");
const { GetCollections, GetCollectionByHandle, CreateCollection, UpdateCollection, DeleteCollection } = require('../graphql');
const SyncResultTracker = require('../utils/SyncResultTracker');
const CollectionRuleSetHandler = require('../utils/CollectionRuleSetHandler');

class CollectionSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.resultTracker = new SyncResultTracker();
    this.targetChannels = null;
    this.targetPublications = null;
    this.lastProcessedCollection = null;
    this.targetMetafieldDefinitions = {};
    this.ruleSetHandler = null; // Will be initialized after metafield definitions are fetched
  }

  // --- Main Sync Method ---
  async sync() {
    logger.info(`Syncing collections...`);

    // Check if we're in delete mode
    if (this.options.delete) {
      return await this._handleDeleteMode();
    }

    // Fetch collections from source and target shops
    const sourceCollections = await this._fetchSourceCollections();

    // Add extensive logging to diagnose rule structure
    logger.info(`Analyzing ${sourceCollections.length} source collections for metafield rules...`);
    for (const collection of sourceCollections) {
      logger.info(`Collection: ${collection.title}`);

      if (collection.ruleSet) {
        logger.info(`  Has ruleSet with ${collection.ruleSet.rules ? collection.ruleSet.rules.length : 0} rules`);

        if (collection.ruleSet.rules && collection.ruleSet.rules.length > 0) {
          collection.ruleSet.rules.forEach((rule, index) => {
            logger.info(`  Rule ${index + 1}: column=${rule.column}, condition=${rule.condition}`);

            // Log the entire rule for debugging
            logger.info(`  Rule details: ${JSON.stringify(rule)}`);

            // Check for any kind of metafield rule
            if (rule.column === 'METAFIELD' || rule.column === 'PRODUCT_METAFIELD_DEFINITION') {
              logger.info(`  ✓ Found metafield rule! Type: ${rule.column}`);
              if (rule.conditionObject) {
                logger.info(`    Has conditionObject: ${JSON.stringify(rule.conditionObject)}`);
              } else {
                logger.info(`    No conditionObject found in the rule`);
              }
            }
          });
        }
      } else {
        logger.info(`  No ruleSet found`);
      }
    }

    const targetCollections = await this.fetchCollections(this.targetClient, null);
    logger.info(`Found ${targetCollections.length} collection(s) in target shop`);

    const targetCollectionMap = this._buildTargetCollectionMap(targetCollections);

    // Fetch available channels and publications for the target store
    if (!this.options.skipPublications) {
      await this._fetchTargetPublicationData();
    }

    // Fetch ALL metafield definitions for all common owner types to ensure we have everything
    logger.info(`Fetching all metafield definitions from target shop...`);
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

    for (const ownerType of allOwnerTypes) {
      logger.info(`Fetching metafield definitions for owner type: ${ownerType}`);
      metafieldDefinitions[ownerType] = await this._fetchTargetMetafieldDefinitions(ownerType);
    }

    this.targetMetafieldDefinitions = metafieldDefinitions;

    // Initialize the ruleset handler with the metafield definitions
    this.ruleSetHandler = new CollectionRuleSetHandler(this.targetMetafieldDefinitions);

    // Process collections
    logger.indent();
    await this._processCollections(sourceCollections, targetCollectionMap);
    logger.unindent();

    logger.success(`Finished syncing collections.`);
    logger.newline();

    return this.resultTracker.formatForStrategyResult();
  }

  // --- Handle Delete Mode ---
  async _handleDeleteMode() {
    logger.warn(`Running in DELETE mode. Collections in target shop will be deleted.`);

    // Get the target collections
    const targetCollections = await this.fetchCollections(this.targetClient, null);
    logger.info(`Found ${targetCollections.length} collection(s) in target shop to evaluate for deletion`);

    // Filter by handle if provided
    let collectionsToDelete = targetCollections;
    if (this.options.handle) {
      const handle = this.options.handle.trim().toLowerCase();
      collectionsToDelete = targetCollections.filter(collection =>
        collection.handle && collection.handle.toLowerCase() === handle
      );
      logger.info(`Filtered to ${collectionsToDelete.length} collection(s) matching handle "${this.options.handle}"`);
    }

    // Filter by ID if provided
    if (this.options.id) {
      const normalizedId = this.options.id.startsWith('gid://')
        ? this.options.id
        : `gid://shopify/Collection/${this.options.id}`;

      collectionsToDelete = targetCollections.filter(collection =>
        collection.id === normalizedId
      );
      logger.info(`Filtered to ${collectionsToDelete.length} collection(s) matching ID "${this.options.id}"`);
    }

    // Apply the limit if provided
    if (this.options.limit && collectionsToDelete.length > this.options.limit) {
      collectionsToDelete = collectionsToDelete.slice(0, this.options.limit);
      logger.info(`Limited to ${collectionsToDelete.length} collection(s) due to --limit option`);
    }

    // Delete collections
    let deleteCount = 0;
    let failCount = 0;

    logger.indent();
    for (const collection of collectionsToDelete) {
      logger.info(`Deleting collection: ${collection.title} (${collection.handle})`);

      const deleted = await this.deleteCollection(this.targetClient, collection.id);
      if (deleted) {
        this.resultTracker.trackDeletion();
        deleteCount++;
      } else {
        this.resultTracker.trackFailure();
        failCount++;
      }
    }
    logger.unindent();

    logger.success(`Finished delete operation.`);
    logger.info(`Deleted: ${deleteCount}, Failed: ${failCount}`);
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
        DeleteCollection,
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

    // Process ruleset using the handler
    if (collection.ruleSet && collection.ruleSet.rules) {
      // Analyze and log ruleset details
      this.ruleSetHandler.analyzeRuleSet(collection);

      // Prepare rules with conditionObjectId for metafield conditions
      input.ruleSet = this.ruleSetHandler.prepareRuleSetInput(collection);
    }

    // Add metafields if available
    if (collection.metafields && collection.metafields.edges && collection.metafields.edges.length > 0) {
      // In Shopify API Collection Input requires specific metafield format
      logger.info(`Preparing ${collection.metafields.edges.length} metafields for collection "${collection.title}"`);

      input.metafields = collection.metafields.edges.map(edge => {
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
          // Fix: Use key/namespace/value format instead of definitionId
          return {
            key: node.key,
            namespace: node.namespace,
            value: node.value,
            type: matchingDef.type ? matchingDef.type.name : "string"
          };
        } else {
          logger.error(`No matching metafield definition found for ${node.namespace}.${node.key} with ownerType=${node.definition.ownerType}`);
          return null;
        }
      }).filter(Boolean);
    }

    return input;
  }

  async _fetchSourceCollections() {
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
    // Store reference to the current collection for error handling
    this.lastProcessedCollection = collection;

    // Skip collections without a handle
    if (!collection.handle) {
      logger.warn(`Skipping collection with no handle: ${collection.title || 'Unnamed collection'}`);
      this.resultTracker.trackSkipped();
      return;
    }

    const normalizedHandle = collection.handle.trim().toLowerCase();
    const existingCollection = targetCollectionMap[normalizedHandle];

    logger.info(`Collection: ${collection.title}`);
    logger.indent();

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

    logger.unindent();
  }

  async _updateExistingCollection(collection, existingCollection) {
    logger.info(`Updating collection: ${collection.title} (${collection.handle})`);
    logger.indent();

    // If collection has metafields, just log count
    if (collection.metafields && collection.metafields.edges && collection.metafields.edges.length > 0) {
      logger.info(`Collection has ${collection.metafields.edges.length} metafields`);
      // Prepare metafields without detailed logging
      this._prepareMetafields(collection);
    }

    const updated = await this.updateCollection(this.targetClient, collection, existingCollection);
    if (updated) {
      this.resultTracker.trackUpdate();
    } else {
      this.resultTracker.trackFailure();
    }
    logger.unindent();
    return updated;
  }

  _prepareMetafields(collection) {
    const metafields = collection.metafields.edges;
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

  async _createNewCollection(collection) {
    logger.info(`Creating collection: ${collection.title} (${collection.handle})`);
    logger.indent();

    // Check for metafield-related rules in smart collections
    if (collection.ruleSet && collection.ruleSet.rules) {
      // Log information about metafield rules using the handler
      this.ruleSetHandler.logMetafieldRules(collection);
    }

    // If collection has metafields, just log count
    if (collection.metafields && collection.metafields.edges && collection.metafields.edges.length > 0) {
      logger.info(`Collection has ${collection.metafields.edges.length} metafields`);
      // Prepare metafields without detailed logging
      this._prepareMetafields(collection);
    }

    const created = await this.createCollection(this.targetClient, collection);
    if (created) {
      this.resultTracker.trackCreation();
    } else {
      this.resultTracker.trackFailure();
    }
    logger.unindent();
    return created;
  }

  _logOperationErrors(operation, collectionTitle, errors) {
    logger.error(`Failed to ${operation} collection "${collectionTitle}":`);
    logger.indent();

    // Check for metafield definition errors
    const metafieldErrors = errors.filter(err =>
      err.message && (
        err.message.includes('metafield definition') ||
        err.message.includes('The metafield definition')
      )
    );

    if (metafieldErrors.length > 0) {
      logger.error(`Metafield Definition Errors:`);
      logger.indent();

      // If collection has metafields, try to log which one is causing problems
      if (this.lastProcessedCollection && this.lastProcessedCollection.metafields) {
        const metafields = this.lastProcessedCollection.metafields.edges
          ? this.lastProcessedCollection.metafields.edges.map(edge => edge.node)
          : this.lastProcessedCollection.metafields;

        logger.error(`Collection has the following metafields:`);
        logger.indent();

        metafields.forEach(metafield => {
          if (metafield.namespace && metafield.key) {
            const ownerType = metafield.definition?.ownerType || "UNKNOWN";
            logger.error(`- ${metafield.namespace}.${metafield.key} (Type: ${metafield.type || 'unknown type'}, Owner Type: ${ownerType})`);
          }
        });

        logger.unindent();

        // Check for metafield conditions in rule set
        if (this.lastProcessedCollection.ruleSet && this.lastProcessedCollection.ruleSet.rules) {
          // Log information about ruleset errors using the handler
          this.ruleSetHandler.logRuleErrors(this.lastProcessedCollection);
        }
      } else {
        logger.error(`Could not find metafield information for this collection.`);
      }

      logger.unindent();
    }

    // Log errors with proper formatting
    logger.error(`API Errors:`);
    logger.indent();

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

    logger.unindent();
    logger.unindent();
  }

  // --- Metafield Definition Methods ---
  async _fetchTargetMetafieldDefinitions(ownerType = "COLLECTION") {
    logger.info(`Fetching metafield definitions for ${ownerType} in target shop...`);

    const metafieldDefinitionsQuery = `#graphql
      query GetMetafieldDefinitions($ownerType: MetafieldOwnerType!) {
        metafieldDefinitions(ownerType: $ownerType, first: 100) {
          edges {
            node {
              id
              name
              namespace
              key
              description
              type {
                name
              }
              validations {
                name
                value
              }
              ownerType
            }
          }
        }
      }
    `;

    try {
      const response = await this.targetClient.graphql(
        metafieldDefinitionsQuery,
        { ownerType },
        'GetMetafieldDefinitions'
      );

      const definitions = response.metafieldDefinitions.edges.map(edge => edge.node);
      logger.info(`Found ${definitions.length} metafield definitions for ${ownerType} in target shop`);


      return definitions;
    } catch (error) {
      logger.error(`Error fetching metafield definitions: ${error.message}`);
      return [];
    }
  }

  async _lookupMetafieldDefinitionIds(collection) {
    if (!collection.metafields || !collection.metafields.edges || collection.metafields.edges.length === 0) {
      return null;
    }

    // Always use COLLECTION owner type
    const ownerType = "COLLECTION";
    const targetDefinitions = await this._fetchTargetMetafieldDefinitions(ownerType);

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
}

module.exports = CollectionSyncStrategy;
