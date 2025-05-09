const { program } = require("commander");
const consola = require('consola');

/**
 * Setup command line options and parse argv
 * @returns {Object} The parsed command line options
 */
function setupCommandLineOptions() {
  // Define common options for all commands
  const addCommonOptions = (command) => {
    return command
      .option("--source <n>", "Source shop name (must exist in .shops.json)")
      .option("--target <n>", "Target shop name (must exist in .shops.json). Defaults to source shop if not specified")
      .option("--live", "Make actual changes (default is dry run)", false)
      .option("--debug", "Enable debug logging", false)
      .option("--batch-size <number>", "Batch size for pagination", 25)
      .option("--limit <number>", "Limit the number of items to process per run", (value) => parseInt(value, 10), 3);
  };

  // Create an object to store merged options from all commands
  let mergedOptions = {};

  // Main program
  program
    .name("metasync")
    .description("Metasync CLI for Shopify - sync resources between shops")
    .version("1.0.0")
    .addHelpText('beforeAll', `
Metasync - A CLI tool for synchronizing Shopify resources

USAGE:
  metasync define metafields --resource <resource> --namespace <namespace> [options]
  metasync define metaobject --type <type> [options]
  metasync data <resource> [options]

COMMON OPTIONS:
  --source <shop>        Source shop name (must exist in .shops.json)
  --target <shop>        Target shop name (defaults to source if not specified)
  --live                 Make actual changes (default is dry run)
  --debug                Enable debug logging
  --limit <number>       Limit the number of items to process (default: 3)
    `)
    .addHelpText('afterAll', `
Examples:
  # Define metafield definitions for products
  metasync define metafields --resource product --namespace custom --source shopA --target shopB

  # Define metaobject definitions
  metasync define metaobject --type territory --source shopA --target shopB

  # Sync product data
  metasync data product --handle my-product --source shopA --target shopB --live

  # Sync metaobject data
  metasync data metaobject --type territory --source shopA --target shopB
    `);

  // Define command - for definition-only work
  const defineCommand = program
    .command("define")
    .description("Sync only the definitions, not the data")
    .addHelpText('after', `
Examples:
  metasync define metafields --resource product --namespace custom
  metasync define metaobject --type territory
    `);

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
      // Set command type
      mergedOptions.command = "define";
      mergedOptions.resource = cmdOptions.resource || "product"; // Default to product if not specified
    });

  const defineMetaobjectsCmd = defineCommand
    .command("metaobject")
    .description("Sync metaobject definitions")
    .option("--type <type>", "Specific metaobject definition type to sync (e.g., 'my_app.my_def')")
    .action((cmdOptions) => {
      // Merge command options with main options
      Object.assign(mergedOptions, cmdOptions);
      // Set command type
      mergedOptions.command = "define";
      mergedOptions.resource = "metaobject";
      // Map type to key for backwards compatibility
      if (cmdOptions.type) {
        mergedOptions.key = cmdOptions.type;
      }
    });

  // Add common options to define subcommands
  addCommonOptions(defineMetafieldsCmd);
  addCommonOptions(defineMetaobjectsCmd);

  // Data command - for data-only sync
  const dataCommand = program
    .command("data")
    .description("Sync data for specified resources (no definitions)")
    .addHelpText('after', `
Available resources:
  product       Sync product data
  metaobject    Sync metaobject data
  page          Sync page data
  customer      Sync customer data (if implemented)
  order         Sync order data (if implemented)
  variant       Sync variant data (if implemented)

Examples:
  metasync data product --handle my-product
  metasync data metaobject --type territory
    `);

  // Define resources and their options for data commands
  const resources = ["product", "metaobject", "page", "customer", "order", "variant"];
  resources.forEach(resource => {
    const cmd = dataCommand
      .command(resource)
      .description(`Sync ${resource} data`);

    // Add resource-specific options
    if (resource === "product") {
      cmd.option("--handle <handle>", "Product handle to sync")
         .option("--id <id>", "Product ID to sync")
         .option("--namespace <namespace>", "Sync only metafields with this namespace")
         .option("--key <key>", "Sync only metafields with this key (format: 'key' or 'namespace.key')")
         .option("--force-recreate", "Delete and recreate products instead of updating", false)
         .option("--batch-size <size>", "Number of products to process in each batch", 25)
         .option("--start-cursor <cursor>", "Pagination cursor to start from (for resuming interrupted syncs)")
         .addHelpText('after', `
Examples:
  metasync data product --handle my-product --source shopA --target shopB
  metasync data product --force-recreate --source shopA --target shopB
  metasync data product --batch-size 10 --source shopA --target shopB
  metasync data product --start-cursor "endCursor123" --source shopA --target shopB
  metasync data product --namespace custom --key breadcrumbs --source shopA --target shopB
         `);
    } else if (resource === "metaobject") {
      cmd.option("--type <type>", "Metaobject definition type to sync (required)")
         .option("--handle <handle>", "Metaobject handle to sync")
         .addHelpText('after', `
Examples:
  metasync data metaobject --type territory --source shopA --target shopB
         `);
    } else if (resource === "page") {
      cmd.option("--handle <handle>", "Page handle to sync")
         .option("--id <id>", "Page ID to sync");
    }

    // Add action
    cmd.action((cmdOptions) => {
      // Merge command options with main options
      Object.assign(mergedOptions, cmdOptions);
      mergedOptions.resource = resource;

      // Set command type
      mergedOptions.command = "data";

      // Map type to key for metaobjects (for backwards compatibility)
      if (resource === "metaobject" && cmdOptions.type) {
        mergedOptions.key = cmdOptions.type;
      }
    });

    // Add common options
    addCommonOptions(cmd);
  });

  // For legacy support, show new command structure if someone uses older commands
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

  // For legacy support, show new command structure if someone uses older commands
  if (program.args.length > 0 && !mergedOptions.command) {
    consola.warn(`Note: Command structure has changed. Try using one of these commands instead:`);
    consola.info(`  metasync define metafields --resource <resource> --namespace <namespace>`);
    consola.info(`  metasync define metaobject --type <type>`);
    consola.info(`  metasync data product|metaobject|page [options]`);
  }

  return mergedOptions;
}

module.exports = {
  setupCommandLineOptions
};
