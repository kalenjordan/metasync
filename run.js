#!/usr/bin/env node

const path = require("path");
const fs = require("fs");
const { program } = require("commander");
const Shopify = require('shopify-api-node');
const ShopifyClientWrapper = require('./shopifyClientWrapper'); // Import the wrapper
const consola = require('consola'); // Import consola
const { SHOPIFY_API_VERSION } = require('./constants'); // Import centralized constants
// Require strategies as needed (or dynamically)
const MetaobjectSyncStrategy = require('./strategies/MetaobjectSyncStrategy');
const ProductMetafieldSyncStrategy = require('./strategies/ProductMetafieldSyncStrategy');
const CompanyMetafieldSyncStrategy = require('./strategies/CompanyMetafieldSyncStrategy');
const OrderMetafieldSyncStrategy = require('./strategies/OrderMetafieldSyncStrategy');
const VariantMetafieldSyncStrategy = require('./strategies/VariantMetafieldSyncStrategy');
const CustomerMetafieldSyncStrategy = require('./strategies/CustomerMetafieldSyncStrategy');
const PageSyncStrategy = require('./strategies/PageSyncStrategy');
const ProductSyncStrategy = require('./strategies/ProductSyncStrategy');

/**
 * Get shop configuration from .shops.json file by shop name
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

    // Rename notADrill to live for backwards compatibility
    this.options.notADrill = this.options.live;

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
    this.sourceClient = new ShopifyClientWrapper(sourceClientInstance, this.options.debug);
    this.targetClient = new ShopifyClientWrapper(targetClientInstance, this.options.debug);
  }

  static setupCommandLineOptions() {
    // Define common options for all commands
    const addCommonOptions = (command) => {
      return command
        .option("--source <n>", "Source shop name (must exist in .shops.json)")
        .option("--target <n>", "Target shop name (must exist in .shops.json). Defaults to source shop if not specified")
        .option("--live", "Make actual changes (default is dry run)", false)
        .option("--debug", "Enable debug logging", false)
        .option("--limit <number>", "Limit the number of items to process per run", (value) => parseInt(value, 10), 3);
    };

    // Create an object to store merged options from all commands
    let mergedOptions = {};

    // Main program
    program
      .name("metasync")
      .description("Metasync CLI for Shopify - sync or define resources between shops")
      .version("1.0.0");

    // Define command - for definition only work
    const defineCommand = program
      .command("define")
      .description("Sync only the definitions, not the data");

    // Define subcommands
    const defineMetafieldsCmd = defineCommand
      .command("metafields")
      .description("Sync metafield definitions")
      .option("--resource <type>", "Type of resource (product, company, order, variant, customer)")
      .option("--namespace <namespace>", "Namespace to sync")
      .option("--key <key>", "Specific definition key to sync (e.g., 'namespace.key' - optional if --namespace is used)")
      .action((cmdOptions) => {
        // Merge command options with main options
        Object.assign(mergedOptions, cmdOptions);
        mergedOptions.definitionsOnly = true;
        mergedOptions.resource = cmdOptions.resource || "product"; // Default to product if not specified
      });

    const defineMetaobjectsCmd = defineCommand
      .command("metaobjects")
      .description("Sync metaobject definitions")
      .option("--type <type>", "Specific metaobject definition type to sync (e.g., 'my_app.my_def')")
      .action((cmdOptions) => {
        // Merge command options with main options
        Object.assign(mergedOptions, cmdOptions);
        mergedOptions.resource = "metaobjects";
        mergedOptions.definitionsOnly = true;
        // Map type to key for backwards compatibility
        if (cmdOptions.type) {
          mergedOptions.key = cmdOptions.type;
        }
      });

    // Add common options to define subcommands
    addCommonOptions(defineMetafieldsCmd);
    addCommonOptions(defineMetaobjectsCmd);

    // Sync command - for data-only sync
    const syncCommand = program
      .command("sync")
      .description("Sync data for specified resources (no definitions)");

    // Sync subcommands
    const resources = ["product", "customer", "order", "variant", "page", "metaobject"];

    resources.forEach(resource => {
      const cmd = syncCommand
        .command(resource)
        .description(`Sync ${resource} data`)
        .action((cmdOptions) => {
          // Merge command options with main options
          Object.assign(mergedOptions, cmdOptions);
          mergedOptions.resource = resource === "metaobject" ? "metaobjects" : resource;

          // All sync commands are data-only
          mergedOptions.definitionsOnly = false;
          mergedOptions.dataOnly = true;

          // Map type to key for metaobjects (for backwards compatibility)
          if (resource === "metaobject" && cmdOptions.type) {
            mergedOptions.key = cmdOptions.type;
          }
        });

      // Add resource-specific options
      if (resource === "product") {
        cmd.option("--handle <handle>", "Specific product handle to sync");
        cmd.option("--force-recreate", "Delete and recreate products instead of updating", false);
      } else if (resource === "metaobject") {
        cmd.option("--type <type>", "Specific metaobject type to sync");
      }

      // Add common options
      addCommonOptions(cmd);

      // Add metafield options for resources that support them
      if (["product", "customer", "order", "variant"].includes(resource)) {
        cmd.option("--namespace <namespace>", "Metafield namespace to sync");
        cmd.option("--key <key>", "Specific metafield key to sync (e.g., 'namespace.key')");
      }
    });

    // For legacy support, add a help command to show the new usage pattern
    program
      .on('command:*', function (operands) {
        const availableCommands = program.commands.map(cmd => cmd.name());
        consola.error(`Error: unknown command '${operands[0]}'`);
        consola.info(`Available commands: ${availableCommands.join(', ')}`);
        process.exit(1);
      });

    program.parse(process.argv);

    // If no options have been merged from subcommands, we might be in a direct command
    // Get any options directly from the program
    const programOptions = program.opts();
    Object.assign(mergedOptions, programOptions);

    return mergedOptions;
  }

  async run() {
    let definitionResults = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let dataResults = { created: 0, updated: 0, skipped: 0, failed: 0 };

    // Define valid resource types early
    const validResourceTypes = ['metaobjects', 'product', 'company', 'order', 'variant', 'customer', 'page'];
    const metafieldResourceTypes = ['product', 'company', 'order', 'variant', 'customer']; // Types requiring namespace

    // Check if resource type was provided
    if (!this.options.resource) {
      consola.info("Please specify the resource type to sync.");
      consola.info(`Available resource types: ${validResourceTypes.join(', ')}`);
      return; // Exit gracefully
    }

    // Validate provided resource type
    if (!validResourceTypes.includes(this.options.resource)) {
      consola.error(`Error: Invalid resource type "${this.options.resource}". Valid types are: ${validResourceTypes.join(', ')}`);
      process.exit(1);
    }

    // Validate options based on resource type and command mode
    if (metafieldResourceTypes.includes(this.options.resource) && this.options.definitionsOnly) {
        // Namespace is required for metafield definitions
        if (!this.options.namespace) {
            consola.error(`Error: --namespace is required when syncing ${this.options.resource} metafield definitions.`);
            process.exit(1);
        }

        // If key is provided, ensure it matches the namespace
        if (this.options.key && !this.options.key.startsWith(this.options.namespace + '.')) {
             consola.error(`Error: Provided --key "${this.options.key}" does not start with the provided --namespace "${this.options.namespace}".`);
             process.exit(1);
        }
    }

    // For metaobjects, key is required when syncing data
    if (this.options.resource === 'metaobjects' && this.options.dataOnly && !this.options.key) {
        consola.error(`Error: --type is required when syncing metaobject data.`);
        process.exit(1);
    }

    // Display info
    consola.info(`Syncing Resource Type: ${this.options.resource}`);
    consola.info(`Sync Mode: ${this.options.definitionsOnly ? 'Definitions Only' : 'Data Only'}`);
    consola.info(`Dry Run: ${!this.options.live ? 'Yes (no changes will be made)' : 'No (changes will be made)'}`);
    consola.info(`Debug: ${this.options.debug ? 'Enabled' : 'Disabled'}`);
    consola.info(`Limit: ${this.options.limit}`);

    // Log force-recreate if it's product data sync
    if (this.options.resource === 'product' && this.options.dataOnly && this.options.forceRecreate) {
      consola.info(`Force Recreate: ${this.options.forceRecreate ? 'Yes' : 'No'}`);
    }

    // Determine if we need to list definitions and exit
    let shouldListAndExit = false;
    let listPrompt = "";

    if (this.options.resource === 'metaobjects' && !this.options.key) {
        shouldListAndExit = true;
        listPrompt = "\nPlease run the command again with --type <type> to specify which metaobject type to sync.";
        consola.info(`No specific metaobject type specified (--type). Fetching available types...`);
    } else if (metafieldResourceTypes.includes(this.options.resource) && this.options.definitionsOnly && !this.options.namespace) {
        shouldListAndExit = true;
        listPrompt = `\nPlease run the command again with --namespace <namespace> to specify which ${this.options.resource} metafield namespace to sync.`;
        consola.info(`No namespace specified (--namespace). Fetching all available ${this.options.resource} metafield definitions...`);
    }

    // If no specific key/namespace was provided (as required), show available definitions and exit
    if (shouldListAndExit) {
        let definitions = [];
        let StrategyClass;
        // Map the simplified resource name to the strategy class
        const strategyMap = {
            metaobjects: null, // Handled separately below
            product: ProductMetafieldSyncStrategy,
            company: CompanyMetafieldSyncStrategy,
            order: OrderMetafieldSyncStrategy,
            variant: VariantMetafieldSyncStrategy,
            customer: CustomerMetafieldSyncStrategy,
            page: PageSyncStrategy,
            product_sync: ProductSyncStrategy
        };

        StrategyClass = strategyMap[this.options.resource];

        if (this.options.resource === 'metaobjects') {
            // Handle metaobjects separately as before
            definitions = await this.fetchMetaobjectDefinitions(this.sourceClient);
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
        } else if (StrategyClass) {
            // Handle metafield types using their strategies for listing
            const listStrategy = new StrategyClass(this.sourceClient, null, this.options);
            await listStrategy.listAvailableDefinitions(); // Assumes listAvailableDefinitions exists on base/derived class
            return; // Exit after listing
        } else {
            // Should not happen due to earlier validation, but added as a safeguard
            consola.error(`Cannot list definitions for unsupported resource type: ${this.options.resource}`);
            return;
        }
    }

    // ---------------------------------------------------
    // STRATEGY SELECTION
    // ---------------------------------------------------

    let strategy;
    let syncResults;

    // Define strategy mapping based on resource and sync mode
    const definitionStrategies = {
        product: ProductMetafieldSyncStrategy,
        company: CompanyMetafieldSyncStrategy,
        order: OrderMetafieldSyncStrategy,
        variant: VariantMetafieldSyncStrategy,
        customer: CustomerMetafieldSyncStrategy,
        metaobjects: MetaobjectSyncStrategy
    };

    const dataStrategies = {
        product: ProductSyncStrategy,
        page: PageSyncStrategy,
        metaobjects: MetaobjectSyncStrategy,
        // Add other data strategies as they're implemented
    };

    // Select the appropriate strategy based on resource and command mode
    let StrategyClass;
    if (this.options.definitionsOnly) {
        StrategyClass = definitionStrategies[this.options.resource];
    } else {
        StrategyClass = dataStrategies[this.options.resource];
    }

    if (StrategyClass) {
        // Debugging output for options
        if (this.options.debug) {
            consola.debug(`Options before creating strategy:`, this.options);
        }

        strategy = new StrategyClass(this.sourceClient, this.targetClient, this.options);
    } else {
        if (this.options.dataOnly) {
            consola.error(`Data sync is not yet implemented for ${this.options.resource} resource type.`);
        } else {
            consola.error(`Definition sync is not supported for ${this.options.resource} resource type.`);
        }
        process.exit(1);
    }

    // Execute the sync via the strategy
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
      // Determine the friendly name for the resource type for definitions
      let resourceNameFriendly = this.options.resource;
      if (resourceNameFriendly === 'metaobjects') {
        resourceNameFriendly = 'Metaobject Definitions';
      } else if (metafieldResourceTypes.includes(resourceNameFriendly)) {
        // Capitalize first letter for metafield types
        resourceNameFriendly = resourceNameFriendly.charAt(0).toUpperCase() + resourceNameFriendly.slice(1) + ' Metafield Definitions';
      } else if (resourceNameFriendly === 'page') {
        resourceNameFriendly = 'Pages';
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
