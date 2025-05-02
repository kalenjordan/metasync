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
// Import the new fake product generator
const FakeProductGenerator = require('./utils/FakeProductGenerator');

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
      .description("Sync metaobject definitions or metafield definitions for various resources between Shopify stores")
      .option("--source <n>", "Source shop name (must exist in .shops.json)")
      .option("--target <n>", "Target shop name (must exist in .shops.json). Defaults to source shop if not specified")
      .option("--resource <type>", "Type of resource to sync (metaobjects, product, company, order, variant, customer, page, product_sync)")
      .option("--key <key>", "Specific definition key/type to sync (e.g., 'my_app.my_def' for metaobjects, 'namespace.key' for metafields - optional for metafields if --namespace is used)")
      .option("--namespace <namespace>", "Namespace to sync (required for metafield resources like product, company, order, variant, customer)")
      .option("--definitions-only", "Sync only the definitions, not the data (Metaobject data sync only)")
      .option("--data-only", "Sync only the data, not the definitions (Metaobject data sync only)")
      .option("--not-a-drill", "Make actual changes (default is dry run)", false)
      .option("--debug", "Enable debug logging", false)
      .option("--handle <handle>", "Specific product handle to sync (optional)")
      .option("--force-recreate", "Delete and recreate products instead of updating (for product_sync only)", false)
      .option("--limit <number>", "Limit the number of items to process per run", (value) => parseInt(value, 10), 3);

    // Add generate-fake-products command
    program
      .command('generate-fake-products')
      .description('Generate fake products for testing')
      .option('--limit <number>', 'Number of fake products to generate', 3)
      .option('--shop <shop>', 'Shop name to create products in (must exist in .shops.json)')
      .option('--product-type <type>', 'Specific product type to generate (optional)')
      .option('--not-a-drill', 'Make actual changes (default is dry run)')
      .option('--debug', 'Enable debug logging')
      .action(async (cmdOptions) => {
        try {
          // Check for --not-a-drill directly
          const notADrill = process.argv.includes('--not-a-drill');

          // Set log level based on debug flag
          if (cmdOptions.debug || process.argv.includes('--debug')) {
            consola.level = 3;
          }

          let shopConfig = null;

          // If shop is provided, validate it
          if (cmdOptions.shop) {
            shopConfig = getShopConfig(cmdOptions.shop);
            if (!shopConfig) {
              consola.error(`Error: Shop "${cmdOptions.shop}" not found in .shops.json`);
              process.exit(1);
            }
          }

          consola.info(`Dry Run: ${!notADrill ? 'Yes (no changes will be made)' : 'No (changes will be made)'}`);

          let clientWrapper = null;

          // Only create client if shop is specified
          if (shopConfig) {
            // Create Shopify client
            const shopifyClient = new Shopify({
              shopName: shopConfig.domain.replace('.myshopify.com', ''),
              accessToken: shopConfig.accessToken,
              apiVersion: SHOPIFY_API_VERSION,
              autoLimit: cmdOptions.debug ? false : true
            });

            // Wrap client for centralized logging/handling
            clientWrapper = new ShopifyClientWrapper(shopifyClient, cmdOptions.debug);
          }

          // Create fake product generator
          const fakeGenerator = new FakeProductGenerator(clientWrapper, {
            debug: cmdOptions.debug,
            notADrill: notADrill
          });

          // Generate fake products
          const options = {};
          if (cmdOptions.productType) {
            options.productType = cmdOptions.productType;
          }

          // Get the limit value from command line arguments
          let limit = 3; // Default value
          const limitArgIndex = process.argv.findIndex(arg => arg === '--limit');
          if (limitArgIndex !== -1 && limitArgIndex < process.argv.length - 1) {
            const limitValue = Number(process.argv[limitArgIndex + 1]);
            if (!isNaN(limitValue)) {
              limit = limitValue;
            }
          }

          // Only show debug info if debug flag is enabled
          if (cmdOptions.debug) {
            console.log("Limit value:", limit);
          }

          // Update log message to reflect actual limit
          if (cmdOptions.shop) {
            consola.info(`Generating ${limit} fake products for shop: ${cmdOptions.shop}`);
          } else {
            consola.info(`Generating ${limit} fake products (no shop specified)`);
          }

          const fakeProducts = fakeGenerator.generateProducts(limit, options);

          // Display generated products
          consola.info(`Generated ${fakeProducts.length} fake products:`);
          fakeProducts.forEach((product, index) => {
            consola.info(`${index + 1}. "${product.title}" (${product.variants.length} variants)`);
          });

          // Create products in Shopify (only if shop is specified)
          if (clientWrapper && notADrill) {
            consola.info("Creating products in Shopify...");
            const results = await fakeGenerator.createProducts(fakeProducts);
            consola.success(`Successfully created ${results.created} products (failed: ${results.failed})`);

            // Output created product info
            if (results.products.length > 0) {
              consola.info("Created products:");
              results.products.forEach(product => {
                consola.info(`- ${product.title} (ID: ${product.id})`);
              });
            }
          } else if (clientWrapper) {
            consola.info("[DRY RUN] Would create the above products in Shopify");
            consola.info("Use --not-a-drill to actually create the products");
          } else {
            consola.info("No shop specified. Products were generated but not created in Shopify.");
            consola.info("Use --shop <name> to specify a shop for product creation.");
          }
        } catch (error) {
          consola.error("Error generating fake products:", error);
          process.exit(1);
        }
      });

    program.parse(process.argv);

    return program.opts();
  }

  async run() {
    let definitionResults = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let dataResults = { created: 0, updated: 0, skipped: 0, failed: 0 };

    // Define valid resource types early
    const validResourceTypes = ['metaobjects', 'product', 'company', 'order', 'variant', 'customer', 'page', 'product_sync'];
    const metafieldResourceTypes = ['product', 'company', 'order', 'variant', 'customer']; // Types requiring namespace

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
    if (metafieldResourceTypes.includes(this.options.resource)) {
        // Namespace is required for metafield resources
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
            consola.error(`Error: --data-only is not supported for resource type ${this.options.resource}.`);
            process.exit(1);
        }
        if (!this.options.definitionsOnly && !this.options.dataOnly) {
             // If neither --definitions-only nor --data-only is set, the default is both.
             // We need to explicitly set definitionsOnly for metafields.
             consola.warn(`Warning: Only definition sync is supported for resource type ${this.options.resource}. Proceeding with definitions only.`);
             this.options.definitionsOnly = true;
        }
    }

    // For product_sync, we don't require namespace or key
    if (this.options.resource === 'product_sync' && this.options.definitionsOnly) {
        consola.warn(`Warning: --definitions-only is not applicable for resource type ${this.options.resource}. Ignoring.`);
    }

    // Display info
    consola.info(`Syncing Resource Type: ${this.options.resource}`);
    consola.info(`Dry Run: ${!this.options.notADrill ? 'Yes (no changes will be made)' : 'No (changes will be made)'}`);
    consola.info(`Debug: ${this.options.debug ? 'Enabled' : 'Disabled'}`);
    consola.info(`Limit: ${this.options.limit}`);

    // Log force-recreate if it's product_sync
    if (this.options.resource === 'product_sync') {
      consola.info(`Force Recreate: ${this.options.forceRecreate ? 'Yes' : 'No'}`);
    }

    // Determine if we need to list definitions and exit
    let shouldListAndExit = false;
    let listPrompt = "";

    if (this.options.resource === 'metaobjects' && !this.options.key) {
        shouldListAndExit = true;
        listPrompt = "\nPlease run the command again with --key <type> to specify which metaobject type to sync.";
        consola.info(`No specific metaobject type specified (--key). Fetching available types...`);
    } else if (metafieldResourceTypes.includes(this.options.resource) && !this.options.namespace) {
        // This case is now handled by the validation above, but we keep the structure
        // If validation were removed, this would list all relevant metafields.
        shouldListAndExit = true; // Although validation exits first
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
    // REPLACED SYNC LOGIC WITH STRATEGY PATTERN
    // ---------------------------------------------------

    let strategy;
    let syncResults;

    // Instantiate the appropriate strategy based on the simplified resource name
    const strategyMap = {
        metaobjects: MetaobjectSyncStrategy,
        product: ProductMetafieldSyncStrategy,
        company: CompanyMetafieldSyncStrategy,
        order: OrderMetafieldSyncStrategy,
        variant: VariantMetafieldSyncStrategy,
        customer: CustomerMetafieldSyncStrategy,
        page: PageSyncStrategy,
        product_sync: ProductSyncStrategy
    };

    const StrategyClass = strategyMap[this.options.resource];

    if (StrategyClass) {
        // Debugging output for options
        if (this.options.debug) {
            consola.debug(`Options before creating strategy:`, this.options);
        }

        strategy = new StrategyClass(this.sourceClient, this.targetClient, this.options);
    } else {
        // Should not happen due to earlier validation
        consola.error(`Unsupported resource type: ${this.options.resource}`);
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

  // Skip validation for subcommands like generate-fake-products
  // Check if we're running the main command or a subcommand by checking arguments
  const isSubcommand = process.argv.length > 2 && process.argv[2] === 'generate-fake-products';

  if (!isSubcommand) {
    // Only validate source shop for main command
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
  // The subcommand processing is handled by Commander automatically
}

main().catch(error => {
  consola.fatal("Unhandled Error:", error);
  process.exit(1);
});
