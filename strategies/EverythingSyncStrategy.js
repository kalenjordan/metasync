/**
 * Everything Sync Strategy
 *
 * This strategy syncs everything in order:
 * 1. All metafield definitions (products, companies, orders, variants, customers, collections)
 * 2. Metaobject definitions
 * 3. Data for each resource type (products, metaobjects, pages, collections, etc.)
 */
const chalk = require('chalk');
const logger = require('../utils/logger');

// Import metafield definition strategies
const ProductMetafieldSyncStrategy = require('./ProductMetafieldSyncStrategy');
const CompanyMetafieldSyncStrategy = require('./CompanyMetafieldSyncStrategy');
const OrderMetafieldSyncStrategy = require('./OrderMetafieldSyncStrategy');
const VariantMetafieldSyncStrategy = require('./VariantMetafieldSyncStrategy');
const CustomerMetafieldSyncStrategy = require('./CustomerMetafieldSyncStrategy');
const CollectionMetafieldSyncStrategy = require('./CollectionMetafieldSyncStrategy');

// Import metaobject definition strategy
const MetaobjectSyncStrategy = require('./MetaobjectSyncStrategy');

// Import data sync strategies
const ProductSyncStrategy = require('./ProductSyncStrategy');
const PageSyncStrategy = require('./PageSyncStrategy');
const CollectionSyncStrategy = require('./CollectionSyncStrategy');
const MenuSyncStrategy = require('./MenuSyncStrategy');
const AllResourcesSyncStrategy = require('./AllResourcesSyncStrategy');

class EverythingSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = { ...options };
    this.debug = options.debug;

    // Set namespace to "all" if not specified
    if (!this.options.namespace) {
      this.options.namespace = "all";
    }

    // Store original command
    this.originalCommand = this.options.command;

    // Initialize metafield definition strategies with copies of our options
    this.productMetafieldStrategy = new ProductMetafieldSyncStrategy(sourceClient, targetClient, { ...this.options });
    this.companyMetafieldStrategy = new CompanyMetafieldSyncStrategy(sourceClient, targetClient, { ...this.options });
    this.orderMetafieldStrategy = new OrderMetafieldSyncStrategy(sourceClient, targetClient, { ...this.options });
    this.variantMetafieldStrategy = new VariantMetafieldSyncStrategy(sourceClient, targetClient, { ...this.options });
    this.customerMetafieldStrategy = new CustomerMetafieldSyncStrategy(sourceClient, targetClient, { ...this.options });
    this.collectionMetafieldStrategy = new CollectionMetafieldSyncStrategy(sourceClient, targetClient, { ...this.options });

    // Initialize metaobject definition strategy using a copy of our options
    this.metaobjectDefStrategy = new MetaobjectSyncStrategy(sourceClient, targetClient, { ...this.options });

    // Initialize data sync strategies with copies of our options
    this.productDataStrategy = new ProductSyncStrategy(sourceClient, targetClient, { ...this.options });
    this.pageDataStrategy = new PageSyncStrategy(sourceClient, targetClient, { ...this.options });
    this.collectionDataStrategy = new CollectionSyncStrategy(sourceClient, targetClient, { ...this.options });
    this.menuDataStrategy = new MenuSyncStrategy(sourceClient, targetClient, { ...this.options });

    // We'll use AllResourcesSyncStrategy for syncing all data at once
    this.allResourcesDataStrategy = new AllResourcesSyncStrategy(sourceClient, targetClient, { ...this.options });
  }

  async sync() {
    const startTime = Date.now();
    logger.info(chalk.blue('🔄 Starting Everything Sync - This will sync all definitions and data'));

    // Create result containers
    const results = {
      definitions: { created: 0, updated: 0, skipped: 0, failed: 0 },
      data: { created: 0, updated: 0, skipped: 0, failed: 0 },
      metafields: { processed: 0, transformed: 0, blanked: 0, errors: 0, warnings: 0 }
    };

    try {
      // PHASE 1: Sync all metafield definitions
      logger.info(chalk.cyan('🔄 PHASE 1: Syncing all metafield definitions'));

      // Set command to definitions for this phase
      this.options.command = "definitions";

      // Define the metafield resource types
      const metafieldResourceTypes = [
        { name: 'products', strategy: this.productMetafieldStrategy },
        { name: 'companies', strategy: this.companyMetafieldStrategy },
        { name: 'orders', strategy: this.orderMetafieldStrategy },
        { name: 'variants', strategy: this.variantMetafieldStrategy },
        { name: 'customers', strategy: this.customerMetafieldStrategy },
        { name: 'collections', strategy: this.collectionMetafieldStrategy }
      ];

      // Reset indentation level before each operation
      logger.resetIndent();

      // Process each metafield resource type
      for (const resourceType of metafieldResourceTypes) {
        // Log the resource type
        logger.startSection(`RESOURCE TYPE: ${resourceType.name.toUpperCase()}`);

        // Set resource type in options
        const originalResource = this.options.resource;
        this.options.resource = resourceType.name;

        // Sync definitions for this resource type
        const syncResults = await resourceType.strategy.sync();

        // Restore original resource type
        this.options.resource = originalResource;

        // Merge results
        this._mergeResults(results, syncResults);

        // Unindent after this resource type is done
        logger.endSection();
      }

      // PHASE 2: Sync metaobject definitions
      logger.info(chalk.cyan('🔄 PHASE 2: Syncing metaobject definitions'));

      // Set command to definitions and resource to metaobjects for this phase
      this.options.command = "definitions";
      this.options.resource = "metaobjects";

      // Important: Update the strategy's options directly to ensure type is passed
      this.metaobjectDefStrategy.options.type = "all";

      // Sync metaobject definitions
      logger.startSection(`RESOURCE TYPE: METAOBJECTS`);

      const metaobjectDefResults = await this.metaobjectDefStrategy.sync();
      this._mergeResults(results, metaobjectDefResults);

      logger.endSection();

      // PHASE 3: Sync all resource data
      logger.info(chalk.cyan('🔄 PHASE 3: Syncing all resource data'));

      // Set command to data for this phase
      this.options.command = "data";
      this.options.resource = "all";

      // Important: Make sure type parameter is kept for metaobjects
      // The allResourcesDataStrategy will use this to sync metaobjects
      this.options.type = "all";

      // Update the strategy's options directly
      this.allResourcesDataStrategy.options.type = "all";
      this.allResourcesDataStrategy.metaobjectStrategy.options.type = "all";

      // Use the AllResourcesSyncStrategy to sync all data at once
      const allDataResults = await this.allResourcesDataStrategy.sync();
      this._mergeResults(results, allDataResults);

      // Restore original command and resource
      this.options.command = this.originalCommand;

      const endTime = Date.now();
      const durationSec = ((endTime - startTime) / 1000).toFixed(1);
      logger.info(chalk.green(`✅ Everything Sync Completed in ${durationSec}s`));

      return {
        definitionResults: results.definitions,
        dataResults: results.data,
        metafieldResults: results.metafields
      };
    } catch (error) {
      logger.error(chalk.red('❌ Everything Sync Failed:'), error.message);
      if (this.debug) {
        logger.debug(error.stack);
      }

      // Restore original command
      this.options.command = this.originalCommand;

      return {
        definitionResults: results.definitions,
        dataResults: results.data,
        metafieldResults: results.metafields
      };
    }
  }

  _mergeResults(targetResults, sourceResults) {
    // Skip if source is null or undefined
    if (!sourceResults) return;

    // If source has definitionResults, merge them
    if (sourceResults.definitionResults) {
      Object.keys(sourceResults.definitionResults).forEach(key => {
        if (targetResults.definitions[key] !== undefined) {
          targetResults.definitions[key] += sourceResults.definitionResults[key] || 0;
        }
      });
    }

    // If source has dataResults, merge them
    if (sourceResults.dataResults) {
      Object.keys(sourceResults.dataResults).forEach(key => {
        if (targetResults.data[key] !== undefined) {
          targetResults.data[key] += sourceResults.dataResults[key] || 0;
        }
      });
    }

    // If source has metafieldResults, merge them
    if (sourceResults.metafieldResults) {
      Object.keys(sourceResults.metafieldResults).forEach(key => {
        if (targetResults.metafields[key] !== undefined) {
          targetResults.metafields[key] += sourceResults.metafieldResults[key] || 0;
        }
      });
    }
  }
}

module.exports = EverythingSyncStrategy;
