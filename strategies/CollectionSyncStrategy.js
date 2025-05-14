const logger = require("../utils/logger");
const { GetCollections, GetCollectionByHandle, CreateCollection, UpdateCollection, DeleteCollection } = require('../graphql');
const SyncResultTracker = require('../utils/SyncResultTracker');
const CollectionRuleSetHandler = require('../utils/CollectionRuleSetHandler');

// Import new handler classes
const CollectionFetchHandler = require('../utils/collection/CollectionFetchHandler');
const CollectionOperationHandler = require('../utils/collection/CollectionOperationHandler');
const CollectionPublicationHandler = require('../utils/collection/CollectionPublicationHandler');
const CollectionMetafieldHandler = require('../utils/collection/CollectionMetafieldHandler');
const CollectionProductHandler = require('../utils/collection/CollectionProductHandler');

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

    // Initialize handlers
    this.fetchHandler = new CollectionFetchHandler(sourceClient, targetClient, options);
    this.operationHandler = new CollectionOperationHandler(sourceClient, targetClient, options);
    this.publicationHandler = new CollectionPublicationHandler(sourceClient, targetClient, options);
    this.metafieldHandler = new CollectionMetafieldHandler(sourceClient, targetClient, options);
    this.ruleSetHandler = new CollectionRuleSetHandler();
    this.productHandler = new CollectionProductHandler(sourceClient, targetClient, options);
  }

  // --- Main Sync Method ---
  async sync() {
    logger.info(`Syncing collections...`);

    // Check if we're in delete mode
    if (this.options.delete) {
      return await this._handleDeleteMode();
    }

    // Fetch collections from source and target shops
    const sourceCollections = await this.fetchHandler.fetchSourceCollections();

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

    const targetCollections = await this.fetchHandler.fetchCollections(this.targetClient, null);
    logger.info(`Found ${targetCollections.length} collection(s) in target shop`);

    const targetCollectionMap = this.fetchHandler.buildTargetCollectionMap(targetCollections);

    // Fetch available channels and publications for the target store
    if (!this.options.skipPublications) {
      await this.publicationHandler.fetchTargetPublicationData();
    }

    // Fetch ALL metafield definitions for all common owner types to ensure we have everything
    const targetMetafieldDefinitions = await this.metafieldHandler.fetchAllTargetMetafieldDefinitions();

    // Share metafield definitions with other handlers
    this.operationHandler.setTargetMetafieldDefinitions(targetMetafieldDefinitions);

    // Initialize the ruleset handler with the metafield definitions
    this.ruleSetHandler.setTargetMetafieldDefinitions(targetMetafieldDefinitions);
    this.operationHandler.setRuleSetHandler(this.ruleSetHandler);

    // Process collections
    logger.startSection(`Processing collections...`);
    await this._processCollections(sourceCollections, targetCollectionMap);
    logger.endSection();

    logger.success(`Finished syncing collections.`);
    logger.newline();

    return this.resultTracker.formatForStrategyResult();
  }

  // --- Handle Delete Mode ---
  async _handleDeleteMode() {
    logger.warn(`Running in DELETE mode. Collections in target shop will be deleted.`);

    // Get the target collections
    const targetCollections = await this.fetchHandler.fetchCollections(this.targetClient, null);
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

    logger.startSection(`Deleting collections...`);
    for (const collection of collectionsToDelete) {
      logger.info(`Deleting collection: ${collection.title} (${collection.handle})`);

      const deleted = await this.operationHandler.deleteCollection(this.targetClient, collection.id);
      if (deleted) {
        this.resultTracker.trackDeletion();
        deleteCount++;
      } else {
        this.resultTracker.trackFailure();
        failCount++;
      }
    }
    logger.endSection();

    logger.success(`Finished delete operation.`);
    logger.info(`Deleted: ${deleteCount}, Failed: ${failCount}`);
    logger.newline();

    return this.resultTracker.formatForStrategyResult();
  }

  // --- Process Collections ---
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
    this.operationHandler.setLastProcessedCollection(collection);

    // Skip collections without a handle
    if (!collection.handle) {
      logger.warn(`Skipping collection with no handle: ${collection.title || 'Unnamed collection'}`);
      this.resultTracker.trackSkipped();
      return;
    }

    const normalizedHandle = collection.handle.trim().toLowerCase();
    const existingCollection = targetCollectionMap[normalizedHandle];

    // Log collection type
    const collectionType = collection.ruleSet ? 'Smart' : 'Manual';
    logger.startSection(`Syncing Collection: ${collection.title} (Type: ${collectionType})`);

    let targetCollection;
    if (existingCollection) {
      targetCollection = await this._updateExistingCollection(collection, existingCollection);
    } else {
      targetCollection = await this._createNewCollection(collection);
    }

    // Sync publications if the collection was created/updated successfully and publications are not skipped
    if (targetCollection && !this.options.skipPublications) {
      await this.publicationHandler.syncCollectionPublications(targetCollection.id, collection.publications);
    }

    // Sync products for manual collections automatically if the collection was created/updated successfully
    if (targetCollection && !collection.ruleSet) {
      logger.info(`Syncing products for manual collection: ${collection.title}`);
      await this.productHandler.syncCollectionProducts(collection.id, targetCollection.id);
    }

    logger.endSection();
  }

  async _updateExistingCollection(collection, existingCollection) {
    logger.startSection(`Updating collection: ${collection.title} (${collection.handle})`);

    // If collection has metafields, just log count
    if (collection.metafields && collection.metafields.edges && collection.metafields.edges.length > 0) {
      logger.info(`Collection has ${collection.metafields.edges.length} metafields`);
      // Prepare metafields without detailed logging
      this.operationHandler.prepareMetafields(collection);
    }

    const updated = await this.operationHandler.updateCollection(this.targetClient, collection, existingCollection);
    if (updated) {
      this.resultTracker.trackUpdate();
    } else {
      this.resultTracker.trackFailure();
    }
    logger.endSection();

    return updated;
  }

  async _createNewCollection(collection) {
    logger.startSection(`Creating collection: ${collection.title} (${collection.handle})`);

    // Check for metafield-related rules in smart collections
    if (collection.ruleSet && collection.ruleSet.rules) {
      // Log information about metafield rules using the handler
      this.ruleSetHandler.logMetafieldRules(collection);
    }

    // If collection has metafields, just log count
    if (collection.metafields && collection.metafields.edges && collection.metafields.edges.length > 0) {
      logger.info(`Collection has ${collection.metafields.edges.length} metafields`);
      // Prepare metafields without detailed logging
      this.operationHandler.prepareMetafields(collection);
    }

    const created = await this.operationHandler.createCollection(this.targetClient, collection);
    if (created) {
      this.resultTracker.trackCreation();
    } else {
      this.resultTracker.trackFailure();
    }
    logger.endSection();
    return created;
  }
}

module.exports = CollectionSyncStrategy;
