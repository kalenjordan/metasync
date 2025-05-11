#!/usr/bin/env node

const path = require("path");
const fs = require("fs");
const { execSync } = require('child_process');
const consola = require('consola');
const Shopify = require('shopify-api-node');
const ShopifyClient = require('./utils/ShopifyClient');
const { SHOPIFY_API_VERSION } = require('./constants');
const commandSetup = require('./utils/commandSetup');
const shopConfig = require('./utils/shopConfig');
const validators = require('./utils/validators');

// Import strategies
const strategyLoader = require('./utils/strategyLoader');

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
    if (validators.isProductionShop(targetShopName)) {
      throw new Error(`Cannot use "${targetShopName}" as target - shops with "production" or "prod" in the name are protected for safety.`);
    }

    let targetShopConfig = shopConfig.getShopConfig(targetShopName);

    if (!targetShopConfig) {
      throw new Error(`Target shop "${targetShopName}" not found in .shops.json`);
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
    const validResourceTypes = ['metaobject', 'product', 'company', 'order', 'variant', 'customer', 'page', 'collection'];

    // Check if resource type was provided
    if (!this.options.resource) {
      consola.info("Please specify the resource type to sync.");
      consola.info(`Available resource types: ${validResourceTypes.join(', ')}`);
      return false;
    }

    // Validate provided resource type
    if (!validResourceTypes.includes(this.options.resource)) {
      consola.error(`Error: Invalid resource type "${this.options.resource}". Valid types are: ${validResourceTypes.join(', ')}`);
      process.exit(1);
    }

    return true;
  }

  _validateCommandOptions() {
    const metafieldResourceTypes = ['product', 'company', 'order', 'variant', 'customer'];

    // Command-specific validations
    if (this.options.command === "define") {
      // Validations for define command
      if (metafieldResourceTypes.includes(this.options.resource)) {
        // If key is provided, ensure it's properly formatted with namespace
        if (this.options.key && this.options.namespace) {
          // Check if key already includes the namespace
          if (!this.options.key.includes('.')) {
            // Key doesn't have a dot, so it's not namespace-prefixed
            // Automatically modify the key to include the namespace
            this.options.key = `${this.options.namespace}.${this.options.key}`;
            consola.info(`Formatted key as: "${this.options.key}"`);
          } else if (!this.options.key.startsWith(this.options.namespace + '.')) {
            // Key includes a dot but doesn't start with the namespace
            consola.error(`Error: Provided --key "${this.options.key}" does not match the provided --namespace "${this.options.namespace}".`);
            process.exit(1);
          }
        }
      }
    } else if (this.options.command === "data") {
      // Validations for data command
      // For metaobject, type/key is required when syncing data
      if (this.options.resource === 'metaobject' && !this.options.key) {
        consola.error(`Error: --type is required when syncing metaobject data.`);
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
      consola.warn('Could not determine current git commit');
    }

    // Display info
    consola.info(`Version: ${currentCommit}`);
    consola.info(`Dry Run: ${!this.options.live ? 'Yes (no changes will be made)' : 'No (changes will be made)'}`);
    consola.info(`Limit: ${this.options.limit}`);

    // Log force-recreate if it's product data sync
    if (this.options.resource === 'product' && this.options.command === "data" && this.options.forceRecreate) {
      consola.info(`Force Recreate: ${this.options.forceRecreate ? 'Yes' : 'No'}`);
    }
  }

  _shouldListDefinitionsAndExit() {
    const metafieldResourceTypes = ['product', 'company', 'order', 'variant', 'customer'];

    // Determine if we need to list definitions and exit
    if (this.options.resource === 'metaobject' && !this.options.key) {
      consola.info(`No specific metaobject type specified (--type). Fetching available types...`);
      return true;
    } else if (metafieldResourceTypes.includes(this.options.resource) &&
              this.options.command === "define" &&
              !this.options.namespace) {
      consola.info(`No namespace specified (--namespace). Fetching all available ${this.options.resource} metafield namespaces...`);
      return true;
    }

    return false;
  }

  async _listDefinitionsAndExit() {
    const metafieldResourceTypes = ['product', 'company', 'order', 'variant', 'customer'];
    let listPrompt = "";

    if (this.options.resource === 'metaobject') {
      listPrompt = "\nPlease run the command again with --type <type> to specify which metaobject type to sync.";
      await this._listMetaobjectDefinitions();
    } else if (metafieldResourceTypes.includes(this.options.resource)) {
      listPrompt = `\nPlease run the command again with --namespace <namespace> to specify which ${this.options.resource} metafield namespace to sync.`;
      await this._listMetafieldDefinitions();
    }

    consola.info(listPrompt);
  }

  async _listMetaobjectDefinitions() {
    const definitions = await this.fetchMetaobjectDefinitions(this.sourceClient);
    if (definitions.length === 0) {
      consola.warn(`No metaobject definitions found in source shop.`);
      return;
    }

    consola.info(`\nAvailable metaobject definition types:`);
    definitions.forEach(def => {
      consola.log(`- ${def.type} (${def.name || "No name"})`);
    });
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

    if (this.options.command === "define") {
      StrategyClass = strategyLoader.getDefinitionStrategyForResource(this.options.resource);
    } else {
      StrategyClass = strategyLoader.getDataStrategyForResource(this.options.resource);
    }

    if (StrategyClass) {
      // Debugging output for options
      if (this.options.debug) {
        consola.debug(`Options before creating strategy:`, this.options);
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
      consola.error(`No sync strategy available for ${this.options.resource} ${this.options.command} sync.`);
      return null;
    }
  }

  _displaySummary(definitionResults, dataResults, metafieldResults) {
    let outputTitle = '';
    let outputResults = '';

    // Set output based on command
    if (this.options.command === "define") {
      outputTitle = `Definition Sync Results for ${this.options.resource.toUpperCase()}:`;
      outputResults = `${definitionResults.created} created, ${definitionResults.updated} updated, ${definitionResults.skipped} skipped, ${definitionResults.failed} failed`;

      // Handle deleted count if available (for force recreate)
      if (definitionResults.deleted) {
        outputResults += `, ${definitionResults.deleted} deleted`;
      }
    } else {
      outputTitle = `Data Sync Results for ${this.options.resource.toUpperCase()}:`;

      // If definition results are available
      if (definitionResults.created !== undefined) {
        outputResults = `${definitionResults.created} created, ${definitionResults.updated} updated, ${definitionResults.skipped} skipped, ${definitionResults.failed} failed`;

        // Handle deleted count if available (for force recreate)
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

    consola.success(outputTitle);
    consola.success(outputResults);

    // Display metafield stats if available
    if (metafieldResults && metafieldResults.processed > 0) {
      consola.info(`Metafield References: ${metafieldResults.processed} processed, ${metafieldResults.transformed} transformed, ${metafieldResults.blanked} blanked due to errors, ${metafieldResults.warnings || 0} warnings`);

      // If there were errors, highlight them
      if (metafieldResults.errors > 0) {
        consola.warn(`Found ${metafieldResults.errors} metafield reference errors. Check log for details.`);
      }

      // If there were unsupported reference types, list them
      if (metafieldResults.warnings > 0 && metafieldResults.unsupportedTypes && metafieldResults.unsupportedTypes.length > 0) {
        consola.warn(`Encountered ${metafieldResults.unsupportedTypes.length} unsupported reference types: ${metafieldResults.unsupportedTypes.join(', ')}`);
        consola.info(`These reference types were preserved in their original form. For proper syncing, consider adding support for these types.`);
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
        consola.error(`Error fetching metaobject definitions: ${error.message}`);
        return [];
    }
  }
}

async function main() {
  const options = commandSetup.setupCommandLineOptions();

  // Set consola log level based on debug flag
  if (options.debug) {
    consola.level = 3;
  }

  // Validate we have minimal required configuration
  if (!options.source) {
    consola.error("Error: Source shop name is required");
    process.exit(1);
  }

  if (!shopConfig.getShopConfig(options.source)) {
    consola.error("Error: Source shop not found in .shops.json");
    process.exit(1);
  }

  // Additional safety check for target name containing 'prod'
  if (options.target && validators.isProductionShop(options.target)) {
    consola.error(`Error: Cannot use "${options.target}" as target - shops with "production" or "prod" in the name are protected for safety.`);
    process.exit(1);
  }

  const syncer = new MetaSyncCli(options);
  await syncer.run();
}

main().catch(error => {
  consola.fatal("Unhandled Error:", error);
  process.exit(1);
});
