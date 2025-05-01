#!/usr/bin/env node

const path = require("path");
const fs = require("fs");
const { program } = require("commander");
const Shopify = require('shopify-api-node');
const ShopifyClientWrapper = require('./shopifyClientWrapper'); // Import the wrapper
const consola = require('consola'); // Import consola
// Require strategies as needed (or dynamically)
const MetaobjectSyncStrategy = require('./strategies/MetaobjectSyncStrategy');
const ProductMetafieldSyncStrategy = require('./strategies/ProductMetafieldSyncStrategy');
const CompanyMetafieldSyncStrategy = require('./strategies/CompanyMetafieldSyncStrategy');

/**
 * Get shop configuration from .shops.json file by shop name
 *
 * .shops.json format:
 * [
 *   {
 *     "name": "shop1",
 *     "domain": "shop1.myshopify.com",
 *     "accessToken": "shpat_123456789"
 *   },
 *   {
 *     "name": "shop2",
 *     "domain": "shop2.myshopify.com",
 *     "accessToken": "shpat_987654321"
 *   }
 * ]
 *
 * @param {string} shopName - Shop name to lookup
 * @returns {Object|null} Object with domain and accessToken, or null if not found
 */
function getShopConfig(shopName) {
  if (!shopName) return null;

  try {
    const shopsFile = path.resolve(__dirname, '.shops.json');
    if (!fs.existsSync(shopsFile)) return null;

    const shopsConfig = JSON.parse(fs.readFileSync(shopsFile, 'utf8'));

    // Find the shop by name
    return shopsConfig.find(s => s.name === shopName) || null;
  } catch (error) {
    consola.error('Error reading .shops.json:', error.message);
    return null;
  }
}

class MetaSyncCli {
  constructor(options = {}) {
    this.options = options;
    this.debug = options.debug;

    // Source shop configuration
    const sourceShopName = options.source;
    const sourceShopConfig = getShopConfig(sourceShopName);

    if (!sourceShopConfig) {
      throw new Error(`Source shop "${sourceShopName}" not found in .shops.json`);
    }

    // Target shop configuration - either specified or same as source
    let targetShopName = options.target || sourceShopName;

    // Safety check to prevent accidentally syncing to production
    if (targetShopName.toLowerCase().includes('production') || targetShopName.toLowerCase().includes('prod')) {
      throw new Error(`Cannot use "${targetShopName}" as target - shops with "production" or "prod" in the name are protected for safety.`);
    }

    let targetShopConfig = getShopConfig(targetShopName);

    if (!targetShopConfig) {
      throw new Error(`Target shop "${targetShopName}" not found in .shops.json`);
    }

    // Create Shopify clients
    const sourceClientInstance = new Shopify({
      shopName: sourceShopConfig.domain.replace('.myshopify.com', ''),
      accessToken: sourceShopConfig.accessToken,
      apiVersion: '2024-10',
      autoLimit: this.options.debug ? false : true
    });

    const targetClientInstance = new Shopify({
      shopName: targetShopConfig.domain.replace('.myshopify.com', ''),
      accessToken: targetShopConfig.accessToken,
      apiVersion: '2024-10',
      autoLimit: this.options.debug ? false : true
    });

    // Wrap clients for centralized logging/handling
    this.sourceClient = new ShopifyClientWrapper(sourceClientInstance, this.options.debug);
    this.targetClient = new ShopifyClientWrapper(targetClientInstance, this.options.debug);

    // Add event listeners for call limits if debug is enabled - HANDLED BY WRAPPER NOW
    // if (this.options.debug) {
    //   this.sourceShopifyClient.on('callLimits', limits => console.log('Source shop call limits:', limits));
    //   this.sourceShopifyClient.on('callGraphqlLimits', limits => console.log('Source shop GraphQL limits:', limits));
    //   this.targetShopifyClient.on('callLimits', limits => console.log('Target shop call limits:', limits));
    //   this.targetShopifyClient.on('callGraphqlLimits', limits => console.log('Target shop GraphQL limits:', limits));
    // }
  }

  static setupCommandLineOptions() {
    program
      .description("Sync metaobject or product metafield definitions and data between Shopify stores")
      .option("--source <name>", "Source shop name (must exist in .shops.json)")
      .option("--target <name>", "Target shop name (must exist in .shops.json). Defaults to source shop if not specified")
      .option("--resource <type>", "Type of resource to sync (metaobjects, product_metafields, company_metafields)")
      .option("--key <key>", "Specific definition key/type to sync (e.g., 'my_app.my_def' for metaobjects, 'namespace.key' for metafields - optional for metafields if --namespace is used)")
      .option("--namespace <namespace>", "Namespace to sync (required for product_metafields and company_metafields)")
      .option("--definitions-only", "Sync only the definitions, not the data (Metaobject data sync only)")
      .option("--data-only", "Sync only the data, not the definitions (Metaobject data sync only)")
      .option("--not-a-drill", "Make actual changes (default is dry run)", false)
      .option("--debug", "Enable debug logging", false)
      .option("--limit <number>", "Limit the number of items to process per run", (value) => parseInt(value, 10), 3)
      .parse(process.argv);

    return program.opts();
  }

  async run() {
    let definitionResults = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let dataResults = { created: 0, updated: 0, skipped: 0, failed: 0 };

    // Define valid resource types early
    const validResourceTypes = ['metaobjects', 'product_metafields', 'company_metafields'];

    // Check if resource type was provided
    if (!this.options.resource) {
      consola.info("Please specify the resource type to sync using the --resource option.");
      consola.info(`Available resource types: ${validResourceTypes.join(', ')}`);
      return; // Exit gracefully
    }

    // Validate provided resource type
    if (!validResourceTypes.includes(this.options.resource)) {
      consola.error(`Error: Invalid resource type "${this.options.resource}". Valid types are: ${validResourceTypes.join(', ')}`);
      process.exit(1);
    }

    // Validate options based on resource type
    if (this.options.resource === 'product_metafields' || this.options.resource === 'company_metafields') {
        const resourceName = this.options.resource.replace('_', ' ');
        // Namespace is required for metafields
        if (!this.options.namespace) {
            consola.error(`Error: --namespace is required when --resource is ${this.options.resource}.`);
            process.exit(1);
        }

        // If key is provided, ensure it matches the namespace
        if (this.options.key && !this.options.key.startsWith(this.options.namespace + '.')) {
             consola.error(`Error: Provided --key "${this.options.key}" does not start with the provided --namespace "${this.options.namespace}".`);
             process.exit(1);
        }

        // Currently, only definition sync is supported for metafields
        if (this.options.dataOnly) {
            consola.error(`Error: --data-only is not supported for ${this.options.resource}.`);
            process.exit(1);
        }
        if (!this.options.definitionsOnly && !this.options.dataOnly) {
             // If neither --definitions-only nor --data-only is set, the default is both.
             // We need to explicitly set definitionsOnly for metafields.
             consola.warn(`Warning: Only definition sync is supported for ${this.options.resource}. Proceeding with definitions only.`);
             this.options.definitionsOnly = true;
        }
    }

    // Display info
    consola.info(`Syncing Resource Type: ${this.options.resource}`);
    consola.info(`Dry Run: ${!this.options.notADrill ? 'Yes (no changes will be made)' : 'No (changes will be made)'}`);
    consola.info(`Debug: ${this.options.debug ? 'Enabled' : 'Disabled'}`);
    consola.info(`Limit: ${this.options.limit}`);

    // Determine if we need to list definitions and exit
    let shouldListAndExit = false;
    let listPrompt = "";

    if (this.options.resource === 'metaobjects' && !this.options.key) {
        shouldListAndExit = true;
        listPrompt = "\nPlease run the command again with --key <type> to specify which metaobject type to sync.";
        consola.info(`No specific metaobject type specified (--key). Fetching available types...`);
    } else if ((this.options.resource === 'product_metafields' || this.options.resource === 'company_metafields') && !this.options.namespace) {
        // This case is now handled by the validation above, but we keep the structure
        // If validation were removed, this would list all relevant metafields.
        shouldListAndExit = true; // Although validation exits first
        listPrompt = `\nPlease run the command again with --namespace <namespace> to specify which ${this.options.resource.replace('_', ' ')} namespace to sync.`;
        consola.info(`No namespace specified (--namespace). Fetching all available ${this.options.resource.replace('_', ' ')} definitions...`);
    }

    // If no specific key/namespace was provided (as required), show available definitions and exit
    if (shouldListAndExit) {
        // console.log(`No specific key specified for ${this.options.resource}. Fetching available definitions...`);
        let definitions = [];
        let StrategyClass;
        switch (this.options.resource) {
            case 'metaobjects':
                // Direct fetch method might exist on MetaSyncCli or need instantiation
                // Assuming fetchMetaobjectDefinitions exists as before
                definitions = await this.fetchMetaobjectDefinitions(this.sourceClient);
                break;
            case 'product_metafields':
                StrategyClass = ProductMetafieldSyncStrategy;
                break;
            case 'company_metafields':
                StrategyClass = CompanyMetafieldSyncStrategy;
                break;
            default:
                consola.error(`Cannot list definitions for unsupported resource type: ${this.options.resource}`);
                return;
        }
        if (StrategyClass) {
            const listStrategy = new StrategyClass(this.sourceClient, null, this.options); // Target not needed for listing
            // Assuming listAvailableDefinitions exists and fetches/logs
            await listStrategy.listAvailableDefinitions();
            return; // Exit after listing
        }

        // Fallback for metaobjects or if direct fetching was intended
        if (this.options.resource === 'metaobjects') {
             if (definitions.length === 0) {
                 consola.warn(`No metaobject definitions found in source shop.`);
                 return;
             }
             consola.info(`\nAvailable metaobject definition types:`);
             definitions.forEach(def => {
                 consola.log(`- ${def.type} (${def.name || "No name"})`);
             });
             consola.info(listPrompt);
             return;
        }
        // Note: The listing logic for metafields is now handled within the `listAvailableDefinitions` method of the respective strategy
        // The code above will call that method and exit.
    }

    // ---------------------------------------------------
    // REPLACED SYNC LOGIC WITH STRATEGY PATTERN
    // ---------------------------------------------------

    let strategy;
    let syncResults;

    // Instantiate the appropriate strategy
    switch (this.options.resource) {
        case 'metaobjects':
            strategy = new MetaobjectSyncStrategy(this.sourceClient, this.targetClient, this.options);
            break;
        case 'product_metafields':
            strategy = new ProductMetafieldSyncStrategy(this.sourceClient, this.targetClient, this.options);
            break;
        case 'company_metafields':
            strategy = new CompanyMetafieldSyncStrategy(this.sourceClient, this.targetClient, this.options);
            break;
        default:
            consola.error(`Unsupported resource type: ${this.options.resource}`);
            process.exit(1);
    }

    // Execute the sync via the strategy (if implemented)
    if (strategy) {
        syncResults = await strategy.sync();
        if (syncResults) {
            definitionResults = syncResults.definitionResults || definitionResults;
            dataResults = syncResults.dataResults || dataResults;
        }
    }

    // Display summary
    consola.success("Sync completed:");

    if (!this.options.dataOnly) {
      // Determine the friendly name for the resource type
      let resourceNameFriendly = this.options.resource;
      if (resourceNameFriendly === 'metaobjects') {
        resourceNameFriendly = 'Metaobject Definitions';
      } else if (resourceNameFriendly === 'product_metafields') {
        resourceNameFriendly = 'Product Metafield Definitions';
      } else if (resourceNameFriendly === 'company_metafields') {
        resourceNameFriendly = 'Company Metafield Definitions';
      }
      consola.info(`${resourceNameFriendly}: ${definitionResults.created} created, ${definitionResults.updated} updated, ${definitionResults.failed} failed`);
    }

    if (!this.options.definitionsOnly && this.options.resource === 'metaobjects') {
      consola.info(`Metaobject Data: ${dataResults.created} created, ${dataResults.updated} updated, ${dataResults.failed} failed`);
    }
  }

  async fetchMetaobjectDefinitions(client, type = null) {
    // Existing implementation... - needed for listing when no key is provided
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
  const options = MetaSyncCli.setupCommandLineOptions();

  // Set consola log level based on debug flag
  if (options.debug) {
    consola.level = 3; // Revert to assignment
  }

  // Validate we have minimal required configuration
  if (!options.source) {
    consola.error("Error: Source shop name is required");
    process.exit(1);
  }

  if (!getShopConfig(options.source)) {
    consola.error("Error: Source shop not found in .shops.json");
    process.exit(1);
  }

  // Additional safety check for target name containing 'prod'
  if (options.target && (options.target.toLowerCase().includes('prod') || options.target.toLowerCase().includes('production'))) {
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
