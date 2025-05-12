#!/usr/bin/env node

const path = require("path");
const fs = require("fs");
const { execSync } = require('child_process');
const Shopify = require('shopify-api-node');
const ShopifyClient = require('./utils/ShopifyClient');
const { SHOPIFY_API_VERSION } = require('./constants');
const commandSetup = require('./utils/commandSetup');
const shopConfig = require('./utils/shopConfig');
const chalk = require('chalk');

// Import strategies
const strategyLoader = require('./utils/strategyLoader');
const ShopifyIDUtils = require('./utils/ShopifyIDUtils');
const logger = require('./utils/logger');

class MetaSyncCli {
  constructor(options = {}) {
    this.options = options;
    this.debug = options.debug;

    // Rename notADrill to live for backwards compatibility
    this.options.notADrill = this.options.live;

    // Initialize clients
    this._initializeClients();
  }

  _initializeClients() {
    // Source shop configuration
    const sourceShopName = this.options.source;
    const sourceShopConfig = shopConfig.getShopConfig(sourceShopName);

    if (!sourceShopConfig) {
      throw new Error(`Source shop "${sourceShopName}" not found in .shops.json`);
    }

    // Target shop configuration - either specified or same as source
    let targetShopName = this.options.target || sourceShopName;

    // Safety check to prevent accidentally syncing to production
    // Production protection is now handled through the "protected" field in shop config

    let targetShopConfig = shopConfig.getShopConfig(targetShopName);

    if (!targetShopConfig) {
      throw new Error(`Target shop "${targetShopName}" not found in .shops.json`);
    }

    // Check and store protection status
    this.targetShopProtected = targetShopConfig.protected;

    // If trying to make changes and target shop is protected, exit with error
    if (this.options.notADrill && this.targetShopProtected) {
      logger.error(`Error: Target shop "${targetShopName}" is protected. No changes can be made.`);
      logger.info(`To allow changes, add "protected": false to this shop in .shops.json`);
      process.exit(1);
    } else if (!this.targetShopProtected) {
      logger.info(`Target shop ${chalk.cyan(targetShopName)} is ${chalk.green('unprotected')} in .shops.json`);
    } else {
      logger.info(`Target shop "${targetShopName}" is protected (default).`);
    }

    // Create Shopify clients
    const sourceClientInstance = new Shopify({
      shopName: sourceShopConfig.domain.replace('.myshopify.com', ''),
      accessToken: sourceShopConfig.accessToken,
      apiVersion: SHOPIFY_API_VERSION,
      autoLimit: this.options.debug ? false : true
    });

    const targetClientInstance = new Shopify({
      shopName: targetShopConfig.domain.replace('.myshopify.com', ''),
      accessToken: targetShopConfig.accessToken,
      apiVersion: SHOPIFY_API_VERSION,
      autoLimit: this.options.debug ? false : true
    });

    // Wrap clients for centralized logging/handling
    this.sourceClient = new ShopifyClient(sourceClientInstance, this.options.debug);
    this.targetClient = new ShopifyClient(targetClientInstance, this.options.debug);
  }

  async run() {
    // Initialize result counters
    let definitionResults = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let dataResults = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let metafieldResults = { processed: 0, transformed: 0, blanked: 0, errors: 0 };

    // Validate resource type
    if (!this._validateResourceType()) {
      return;
    }

    // Validate command-specific requirements
    if (!this._validateCommandOptions()) {
      return;
    }

    // Display execution information
    this._displayExecutionInfo();

    // Check if we should just list definitions and exit
    if (this._shouldListDefinitionsAndExit()) {
      await this._listDefinitionsAndExit();
      return;
    }

    // Select and run appropriate strategy
    const syncResults = await this._selectAndRunStrategy();

    if (syncResults) {
      definitionResults = syncResults.definitionResults || definitionResults;
      dataResults = syncResults.dataResults || dataResults;
      metafieldResults = syncResults.metafieldResults || metafieldResults;
    }

    // Display summary
    this._displaySummary(definitionResults, dataResults, metafieldResults);
  }

  _validateResourceType() {
    const validResourceTypes = ['metaobjects', 'products', 'companies', 'orders', 'variants', 'customers', 'pages', 'collections', 'all'];

    // Check if resource type was provided
    if (!this.options.resource) {
      logger.newline();
      logger.info(chalk.bold("Available resource types:"));
      logger.indent();
      validResourceTypes.forEach(type => {
        logger.info(`${chalk.cyan(type)}`, 0, 'main');
      });
      logger.unindent();
      logger.newline();
      logger.info(`Specify the resource type with ${chalk.yellow('--resource <type>')} option`);
      logger.info(`Example: ${chalk.green('metasync definitions metafields --resource products --namespace custom')}`);
      return false;
    }

    // Validate provided resource type
    if (!validResourceTypes.includes(this.options.resource)) {
      logger.error(`Error: Invalid resource type "${this.options.resource}". Valid types are: ${validResourceTypes.join(', ')}`);
      process.exit(1);
    }

    return true;
  }

  _validateCommandOptions() {
    const metafieldResourceTypes = ['products', 'companies', 'orders', 'variants', 'customers'];

    // Command-specific validations
    if (this.options.command === "definitions") {
      // Check if namespace is provided for metafield resources
      if (metafieldResourceTypes.includes(this.options.resource) && !this.options.namespace) {
        logger.newline();
        logger.info(chalk.bold("Missing required namespace option."));
        logger.info(`Specify the namespace with ${chalk.yellow('--namespace <namespace>')} option`);
        logger.info(`Example: ${chalk.green('metasync definitions metafields --resource products --namespace custom')}`);
        logger.info(`You can also use ${chalk.yellow('--namespace all')} to sync all namespaces.`);
        logger.newline();
        return false;
      }

      // Handle comma-separated namespaces
      if (this.options.namespace && this.options.namespace.includes(',')) {
        this.options.namespaces = this.options.namespace.split(',').map(ns => ns.trim());
        logger.info(`Parsed ${this.options.namespaces.length} namespaces: ${this.options.namespaces.join(', ')}`);
      }

      // Validations for define command
      if (metafieldResourceTypes.includes(this.options.resource)) {
        // If key is provided, ensure it's properly formatted with namespace
        if (this.options.key && this.options.namespace) {
          // Check if key already includes the namespace
          if (!this.options.key.includes('.')) {
            // Key doesn't have a dot, so it's not namespace-prefixed
            // Automatically modify the key to include the namespace
            this.options.key = `${this.options.namespace}.${this.options.key}`;
            logger.info(`Formatted key as: "${this.options.key}"`);
          } else if (!this.options.key.startsWith(this.options.namespace + '.')) {
            // Key includes a dot but doesn't start with the namespace
            logger.error(`Error: Provided --key "${this.options.key}" does not match the provided --namespace "${this.options.namespace}".`);
            process.exit(1);
          }
        }
      }
    } else if (this.options.command === "data") {
      // Handle comma-separated namespaces for data command as well
      if (this.options.namespace && this.options.namespace.includes(',')) {
        this.options.namespaces = this.options.namespace.split(',').map(ns => ns.trim());
        logger.info(`Parsed ${this.options.namespaces.length} namespaces for data sync: ${this.options.namespaces.join(', ')}`);
      }

      // Validations for data command
      // For metaobject, type/key is required when syncing data
      if (this.options.resource === 'metaobjects' && !this.options.key) {
        logger.error(`Error: --type is required when syncing metaobject data.`);
        process.exit(1);
      }
    }

    return true;
  }

  _displayExecutionInfo() {
    // Get current git commit
    let currentCommit = 'unknown';
    try {
      currentCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch (error) {
      logger.warn('Could not determine current git commit');
    }

    // Display info
    logger.info(`Version: ${currentCommit}`);
    logger.info(`Dry Run: ${!this.options.live ? 'Yes (no changes will be made)' : 'No (changes will be made)'}`);
    logger.info(`Limit: ${this.options.limit}`);

    // Log force-recreate if it's product data sync
    if (this.options.resource === 'product' && this.options.command === "data" && this.options.forceRecreate) {
      logger.info(`Force Recreate: ${this.options.forceRecreate ? 'Yes' : 'No'}`);
    }
  }

  _shouldListDefinitionsAndExit() {
    const metafieldResourceTypes = ['product', 'company', 'order', 'variant', 'customer'];

    // Determine if we need to list definitions and exit
    if (this.options.resource === 'metaobjects' && !this.options.key) {
      logger.info(`No specific metaobject type specified (--type). Fetching available types...`);
      return true;
    }

    return false;
  }

  async _listDefinitionsAndExit() {
    if (this.options.resource === 'metaobjects') {
      await this._listMetaobjectDefinitions();
    }
  }

  async _listMetaobjectDefinitions() {
    const definitions = await this.fetchMetaobjectDefinitions(this.sourceClient);
    if (definitions.length === 0) {
      logger.warn(`No metaobject definitions found in source shop.`);
      return;
    }

    // Use blank line and proper indentation with blank line after
    logger.newline();
    logger.info(`Available metaobject definition types:`);

    // Increase indentation level before listing types
    logger.indent();

    definitions.forEach(def => {
      // Using 'main' type for info to get the bullet point
      logger.info(`${def.type} (${def.name || "No name"})`, 0, 'main');
    });

    // Reset indentation after the list
    logger.unindent();
  }

  async _listMetafieldDefinitions() {
    // Map the simplified resource name to the strategy class
    const StrategyClass = strategyLoader.getDefinitionStrategyForResource(this.options.resource);

    if (StrategyClass) {
      const listStrategy = new StrategyClass(this.sourceClient, null, this.options);
      await listStrategy.listAvailableDefinitions();
    }
  }

  async _selectAndRunStrategy() {
    // Select the appropriate strategy based on resource and command mode
    let StrategyClass;

    // Special case for 'all' resource type in definitions mode
    if (this.options.command === "definitions" && this.options.resource.toLowerCase() === 'all') {
      logger.info(`Syncing all metafield resource types...`);
      const metafieldResourceTypes = ['products', 'companies', 'orders', 'variants', 'customers'];

      let combinedResults = { created: 0, updated: 0, skipped: 0, failed: 0 };

      // Reset indentation level before each operation
      logger.resetIndent();

      // Process each resource type
      for (const resourceType of metafieldResourceTypes) {
        // Log the resource type
        logger.section(`RESOURCE TYPE: ${resourceType.toUpperCase()}`);

        logger.indent();

        // Get the strategy for this resource type
        const ResourceStrategyClass = strategyLoader.getDefinitionStrategyForResource(resourceType);

        if (ResourceStrategyClass) {
          // Override the resource type temporarily
          const originalResource = this.options.resource;
          this.options.resource = resourceType;

          // Create and run strategy
          const syncStrategy = new ResourceStrategyClass(this.sourceClient, this.targetClient, this.options);
          const syncResults = await syncStrategy.sync();

          // Restore original resource type
          this.options.resource = originalResource;

          // Combine results
          if (syncResults && syncResults.definitionResults) {
            combinedResults.created += syncResults.definitionResults.created || 0;
            combinedResults.updated += syncResults.definitionResults.updated || 0;
            combinedResults.skipped += syncResults.definitionResults.skipped || 0;
            combinedResults.failed += syncResults.definitionResults.failed || 0;
          }
        } else {
          logger.warn(`No sync strategy available for ${resourceType} definitions.`);
        }

        // Unindent after this resource type is done
        logger.unindent();
      }

      return { definitionResults: combinedResults, dataResults: null };
    }

    if (this.options.command === "definitions") {
      StrategyClass = strategyLoader.getDefinitionStrategyForResource(this.options.resource);
    } else {
      StrategyClass = strategyLoader.getDataStrategyForResource(this.options.resource);
    }

    if (StrategyClass) {
      // Debugging output for options
      if (this.options.debug) {
        logger.debug(`Options before creating strategy: ${JSON.stringify(this.options, null, 2)}`);
      }

      const syncStrategy = new StrategyClass(this.sourceClient, this.targetClient, this.options);

      // Run the strategy's sync method
      const syncResults = await syncStrategy.sync();

      if (syncResults && syncResults.metafieldResults) {
        return {
          definitionResults: syncResults.definitionResults || {},
          dataResults: syncResults.dataResults || {},
          metafieldResults: syncResults.metafieldResults || {}
        };
      }

      return syncResults;
    } else {
      logger.error(`No sync strategy available for ${this.options.resource} ${this.options.command} sync.`);
      return null;
    }
  }

  _displaySummary(definitionResults, dataResults, metafieldResults) {
    let outputTitle = '';
    let outputResults = '';

    // Set output based on command
    if (this.options.command === "definitions") {
      outputTitle = `Definition Sync Results for ${this.options.resource.toUpperCase()}:`;
      outputResults = `${definitionResults.created} created, ${definitionResults.updated} updated, ${definitionResults.skipped} skipped, ${definitionResults.failed} failed`;

      // Handle deleted count if available (for delete option or force recreate)
      if (definitionResults.deleted) {
        outputResults += `, ${definitionResults.deleted} deleted`;
      }
    } else {
      // Special case for "all" resource
      if (this.options.resource === 'all') {
        outputTitle = `Complete Sync Results:`;
      } else {
        outputTitle = `Data Sync Results for ${this.options.resource.toUpperCase()}:`;
      }

      // If definition results are available
      if (definitionResults.created !== undefined) {
        outputResults = `Definitions: ${definitionResults.created} created, ${definitionResults.updated} updated, ${definitionResults.skipped} skipped, ${definitionResults.failed} failed`;

        // Handle deleted count if available (for delete option or force recreate)
        if (definitionResults.deleted) {
          outputResults += `, ${definitionResults.deleted} deleted`;
        }
      }

      // If data results are available
      if (dataResults && dataResults.created !== undefined) {
        if (outputResults) {
          outputResults += '\n';
        }
        outputResults += `Objects: ${dataResults.created} created, ${dataResults.updated} updated, ${dataResults.skipped} skipped, ${dataResults.failed} failed`;
      }
    }

    logger.success(outputTitle);
    logger.success(outputResults);

    // Display metafield stats if available
    if (metafieldResults && metafieldResults.processed > 0) {
      logger.info(`Metafield References: ${metafieldResults.processed} processed, ${metafieldResults.transformed} transformed, ${metafieldResults.blanked} blanked due to errors, ${metafieldResults.warnings || 0} warnings`);

      // If there were errors, highlight them
      if (metafieldResults.errors > 0) {
        logger.warn(`Found ${metafieldResults.errors} metafield reference errors. Check log for details.`);
      }

      // If there were unsupported reference types, list them
      if (metafieldResults.warnings > 0 && metafieldResults.unsupportedTypes && metafieldResults.unsupportedTypes.length > 0) {
        logger.warn(`Encountered ${metafieldResults.unsupportedTypes.length} unsupported reference types: ${metafieldResults.unsupportedTypes.join(', ')}`);
        logger.info(`These reference types were preserved in their original form. For proper syncing, consider adding support for these types.`);
      }
    }
  }

  async fetchMetaobjectDefinitions(client, type = null) {
    const query = `#graphql
        query FetchMetaobjectDefinitions {
            metaobjectDefinitions(first: 100) {
                nodes {
                    id
                    name
                    type
                    description
                    fieldDefinitions {
                        key
                        name
                        description
                        required
                        type { name }
                        validations { name value }
                    }
                    access { admin storefront }
                    capabilities {
                       publishable { enabled }
                    }
                }
            }
        }
      `;
    try {
        const response = await client.graphql(query, undefined, 'FetchMetaobjectDefinitions');
        return response.metaobjectDefinitions.nodes;
    } catch (error) {
        logger.error(`Error fetching metaobject definitions: ${error.message}`);
        return [];
    }
  }
}

async function main() {
  // Parse command line arguments and initialize options
  const options = commandSetup.setupCommandLineOptions();

  // Validate we have minimal required configuration
  if (!options.source) {
    logger.error("Error: Source shop name is required");
    process.exit(1);
  }

  if (!shopConfig.getShopConfig(options.source)) {
    logger.error("Error: Source shop not found in .shops.json");
    process.exit(1);
  }

  // Initialize log file
  const logFilePath = logger.initializeLogFile();
  logger.info(`Logging to file: ${logFilePath}`);

  // Create instance and run
  const cli = new MetaSyncCli(options);
  await cli.run();

  // Close log file when done
  logger.closeLogFile();
}

// Run the program
main().catch(error => {
  console.error(`Fatal error: ${error.message}`);
  // Ensure log file is closed on fatal error
  logger.closeLogFile();
  process.exit(1);
});
