const logger = require("../utils/logger");
const MetaobjectDefinitionHandler = require('../utils/MetaobjectDefinitionHandler');
const MetaobjectDataHandler = require('../utils/MetaobjectDataHandler');

class MetaobjectSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.debug = options.debug;

    // Create handlers
    this.definitionHandler = new MetaobjectDefinitionHandler(targetClient, options);
    this.dataHandler = new MetaobjectDataHandler(targetClient, options);
  }

  async sync() {
    // Handle listing definitions if key is missing
    if (!this.options.key) {
      await this.definitionHandler.listAvailableDefinitions(this.sourceClient);
      return { definitionResults: null, dataResults: null }; // Indicate no sync occurred
    }

    // Special case: "--type all" should fetch all definitions
    const shouldFetchAllTypes = this.options.key === 'all';

    // Determine what to sync based on command/strategy type
    const isSyncingDefinitions = this.options.command === 'definitions';
    const isSyncingData = this.options.command === 'data';

    let definitionResults = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let dataResults = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let definitionTypes = [];

    // Sync definitions if requested by command
    if (isSyncingDefinitions) {
      // If syncing all types, pass null to fetch all definitions
      const fetchType = shouldFetchAllTypes ? null : this.options.key;
      const defSync = await this.definitionHandler.syncDefinitions(this.sourceClient, fetchType);
      definitionResults = defSync.results;
      definitionTypes = defSync.definitionTypes;
    } else if (isSyncingData) {
      // If only syncing data, use the provided key as the type
      // For "all", we need to fetch all available types first
      if (shouldFetchAllTypes) {
        // Create temporary source handler to fetch all definitions
        const tempSourceHandler = new MetaobjectDefinitionHandler(this.sourceClient, this.options);
        const allDefinitions = await tempSourceHandler.fetchMetaobjectDefinitions();
        definitionTypes = allDefinitions.map(def => def.type);
        logger.info(`Found ${definitionTypes.length} definition types to sync data for`);
      } else {
        definitionTypes = [this.options.key];
      }

      // Sync data
      if (definitionTypes.length > 0) {
        // Create a source definition handler to fetch required field info
        const sourceDefinitionHandler = new MetaobjectDefinitionHandler(this.sourceClient, this.options);
        dataResults = await this.dataHandler.syncData(
          this.sourceClient,
          this.targetClient,
          definitionTypes,
          sourceDefinitionHandler
        );
      }
    } else {
      // Default: sync both definitions and data
      // If syncing all types, pass null to fetch all definitions
      const fetchType = shouldFetchAllTypes ? null : this.options.key;
      const defSync = await this.definitionHandler.syncDefinitions(this.sourceClient, fetchType);
      definitionResults = defSync.results;
      definitionTypes = defSync.definitionTypes;

      if (definitionTypes.length > 0) {
        // Create a source definition handler to fetch required field info
        const sourceDefinitionHandler = new MetaobjectDefinitionHandler(this.sourceClient, this.options);
        dataResults = await this.dataHandler.syncData(
          this.sourceClient,
          this.targetClient,
          definitionTypes,
          sourceDefinitionHandler
        );
      }
    }

    return { definitionResults, dataResults };
  }
}

module.exports = MetaobjectSyncStrategy;
