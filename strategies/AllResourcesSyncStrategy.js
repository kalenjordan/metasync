/**
 * All Resources Sync Strategy
 *
 * This strategy syncs all supported resource types in one go:
 * - Products
 * - Metaobjects
 * - Pages
 * - Collections
 * - Menus
 * - Customers
 * - Orders
 * - Variants
 */
;
const chalk = require('chalk');
const logger = require('../utils/Logger');

// Import all required strategies
const ProductSyncStrategy = require('./ProductSyncStrategy');
const MetaobjectSyncStrategy = require('./MetaobjectSyncStrategy');
const PageSyncStrategy = require('./PageSyncStrategy');
const CollectionSyncStrategy = require('./CollectionSyncStrategy');
const MenuSyncStrategy = require('./MenuSyncStrategy');
const CustomerMetafieldSyncStrategy = require('./CustomerMetafieldSyncStrategy');
const OrderMetafieldSyncStrategy = require('./OrderMetafieldSyncStrategy');
const VariantMetafieldSyncStrategy = require('./VariantMetafieldSyncStrategy');

class AllResourcesSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options || {};
    this.debug = options.debug;

    // Initialize all individual strategies
    this.productStrategy = new ProductSyncStrategy(sourceClient, targetClient, options);
    this.metaobjectStrategy = new MetaobjectSyncStrategy(sourceClient, targetClient, options);
    this.pageStrategy = new PageSyncStrategy(sourceClient, targetClient, options);
    this.collectionStrategy = new CollectionSyncStrategy(sourceClient, targetClient, options);
    this.menuStrategy = new MenuSyncStrategy(sourceClient, targetClient, options);
    this.customerStrategy = new CustomerMetafieldSyncStrategy(sourceClient, targetClient, options);
    this.orderStrategy = new OrderMetafieldSyncStrategy(sourceClient, targetClient, options);
    this.variantStrategy = new VariantMetafieldSyncStrategy(sourceClient, targetClient, options);
  }

  async sync() {
    const startTime = Date.now();
    logger.info(chalk.blue('📦 Starting All Resources Data Sync - This will sync all supported resource types data'));

    // Create result containers for each resource type
    const results = {
      definitions: { created: 0, updated: 0, skipped: 0, failed: 0 },
      data: { created: 0, updated: 0, skipped: 0, failed: 0 },
      metafields: { processed: 0, transformed: 0, blanked: 0, errors: 0, warnings: 0 }
    };

    try {
      // 1. Sync Products
      logger.info(chalk.cyan('🔄 Step 1: Syncing Products Data'));
      const productResults = await this._syncProducts();
      this._mergeResults(results, productResults);

      // 2. Sync Metaobjects
      logger.info(chalk.cyan('🔄 Step 2: Syncing Metaobjects Data'));
      const metaobjectResults = await this._syncMetaobjects();
      this._mergeResults(results, metaobjectResults);

      // 3. Sync Pages
      logger.info(chalk.cyan('🔄 Step 3: Syncing Pages Data'));
      const pageResults = await this._syncPages();
      this._mergeResults(results, pageResults);

      // 4. Sync Collections
      logger.info(chalk.cyan('🔄 Step 4: Syncing Collections Data'));
      const collectionResults = await this._syncCollections();
      this._mergeResults(results, collectionResults);

      // 5. Sync Menus
      logger.info(chalk.cyan('🔄 Step 5: Syncing Menus Data'));
      const menuResults = await this._syncMenus();
      this._mergeResults(results, menuResults);

      // 6. Sync Customers (metafields only)
      logger.info(chalk.cyan('🔄 Step 6: Syncing Customers Metafields'));
      const customerResults = await this._syncCustomers();
      this._mergeResults(results, customerResults);

      // 7. Sync Orders (metafields only)
      logger.info(chalk.cyan('🔄 Step 7: Syncing Orders Metafields'));
      const orderResults = await this._syncOrders();
      this._mergeResults(results, orderResults);

      // 8. Sync Variants (metafields only)
      logger.info(chalk.cyan('🔄 Step 8: Syncing Variants Metafields'));
      const variantResults = await this._syncVariants();
      this._mergeResults(results, variantResults);

      const endTime = Date.now();
      const durationSec = ((endTime - startTime) / 1000).toFixed(1);
      logger.info(chalk.green(`✅ All Resources Data Sync Completed in ${durationSec}s`));

      return {
        definitionResults: results.definitions,
        dataResults: results.data,
        metafieldResults: results.metafields
      };
    } catch (error) {
      logger.error(chalk.red('❌ All Resources Data Sync Failed:'), error.message);
      logger.debug(error.stack);

      return {
        definitionResults: results.definitions,
        dataResults: results.data,
        metafieldResults: results.metafields
      };
    }
  }

  _mergeResults(targetResults, sourceResults) {
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

  async _syncProducts() {
    try {
      const result = await this.productStrategy.sync();
      return result;
    } catch (error) {
      logger.error(chalk.red('❌ Product Sync Failed:'), error.message);
      return {
        dataResults: { created: 0, updated: 0, skipped: 0, failed: 0 },
        metafieldResults: { processed: 0, transformed: 0, blanked: 0, errors: 0 }
      };
    }
  }

  async _syncMetaobjects() {
    try {
      // Make sure it's in data mode and has a type
      const originalCommand = this.options.command;
      const originalType = this.options.type;

      this.options.command = "data";
      this.options.type = "all";

      // Also update the strategy's options directly
      this.metaobjectStrategy.options.type = "all";

      const result = await this.metaobjectStrategy.sync();

      // Restore original values
      this.options.command = originalCommand;
      this.options.type = originalType;

      return result;
    } catch (error) {
      logger.error(chalk.red('❌ Metaobject Sync Failed:'), error.message);
      return {
        dataResults: { created: 0, updated: 0, skipped: 0, failed: 0 },
        metafieldResults: { processed: 0, transformed: 0, blanked: 0, errors: 0 }
      };
    }
  }

  async _syncPages() {
    try {
      const result = await this.pageStrategy.sync();
      return result;
    } catch (error) {
      logger.error(chalk.red('❌ Page Sync Failed:'), error.message);
      return {
        dataResults: { created: 0, updated: 0, skipped: 0, failed: 0 },
        metafieldResults: { processed: 0, transformed: 0, blanked: 0, errors: 0 }
      };
    }
  }

  async _syncCollections() {
    try {
      const result = await this.collectionStrategy.sync();
      return result;
    } catch (error) {
      logger.error(chalk.red('❌ Collection Sync Failed:'), error.message);
      return {
        dataResults: { created: 0, updated: 0, skipped: 0, failed: 0 },
        metafieldResults: { processed: 0, transformed: 0, blanked: 0, errors: 0 }
      };
    }
  }

  async _syncMenus() {
    try {
      const result = await this.menuStrategy.sync();
      return result;
    } catch (error) {
      logger.error(chalk.red('❌ Menu Sync Failed:'), error.message);
      return {
        dataResults: { created: 0, updated: 0, skipped: 0, failed: 0 },
        metafieldResults: { processed: 0, transformed: 0, blanked: 0, errors: 0 }
      };
    }
  }

  async _syncCustomers() {
    try {
      // Make sure we're in data mode for metafield sync
      const originalCommand = this.options.command;
      this.options.command = "data";
      const result = await this.customerStrategy.sync();
      this.options.command = originalCommand;
      return result;
    } catch (error) {
      logger.error(chalk.red('❌ Customer Metafield Sync Failed:'), error.message);
      return {
        definitionResults: { created: 0, updated: 0, skipped: 0, failed: 0 },
        metafieldResults: { processed: 0, transformed: 0, blanked: 0, errors: 0 }
      };
    }
  }

  async _syncOrders() {
    try {
      // Make sure we're in data mode for metafield sync
      const originalCommand = this.options.command;
      this.options.command = "data";
      const result = await this.orderStrategy.sync();
      this.options.command = originalCommand;
      return result;
    } catch (error) {
      logger.error(chalk.red('❌ Order Metafield Sync Failed:'), error.message);
      return {
        definitionResults: { created: 0, updated: 0, skipped: 0, failed: 0 },
        metafieldResults: { processed: 0, transformed: 0, blanked: 0, errors: 0 }
      };
    }
  }

  async _syncVariants() {
    try {
      // Make sure we're in data mode for metafield sync
      const originalCommand = this.options.command;
      this.options.command = "data";
      const result = await this.variantStrategy.sync();
      this.options.command = originalCommand;
      return result;
    } catch (error) {
      logger.error(chalk.red('❌ Variant Metafield Sync Failed:'), error.message);
      return {
        definitionResults: { created: 0, updated: 0, skipped: 0, failed: 0 },
        metafieldResults: { processed: 0, transformed: 0, blanked: 0, errors: 0 }
      };
    }
  }
}

module.exports = AllResourcesSyncStrategy;
