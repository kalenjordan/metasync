const logger = require("./logger");
const { program } = require("commander");
;

/**
 * Setup command line options and parse argv
 * @returns {Object} The parsed command line options
 */
function setupCommandLineOptions() {
  // Check if we're running a specific command to determine the appropriate help text
  const isDataCommand = process.argv.length > 2 && process.argv[2] === 'data';
  const isDefinitionsCommand = process.argv.length > 2 && process.argv[2] === 'definitions';

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

  // Completely override the help output to suppress Commander's default formatting
  // This prevents duplicated sections
  const customizeHelp = (cmd, headerText) => {
    cmd.configureHelp({
      formatHelp: (cmd, helper) => {
        // Ensure the help text ends with a newline
        return headerText.endsWith('\n') ? headerText : headerText + '\n';
      }
    });
  };

  // Main program setup
  program
    .name("metasync")
    .description("Metasync CLI for Shopify - sync resources between shops")
    .version("1.0.0");

  // Global help text
  const globalHelpText = `
Metasync - A CLI tool for synchronizing Shopify resources

USAGE:
  metasync definitions metafields --resource <resource> --namespace <namespace> [options]
  metasync definitions metafields --resource all --namespace <namespace> [options]
  metasync definitions metaobject --type <type> [options]
  metasync data <resource> [options]

COMMON OPTIONS:
  -h, --help            Display help
  --source <shop>        Source shop name (must exist in .shops.json)
  --target <shop>        Target shop name (defaults to source if not specified)
  --live                 Make actual changes (default is dry run)
  --debug                Enable debug logging
  --limit <number>       Limit the number of items to process (default: 3)

COMMANDS:
  definitions           Sync only the definitions, not the data
  data                  Sync data for specified resources (no definitions)

Examples:
  metasync definitions metafields --resource product --namespace custom --source shopA --target shopB
  metasync definitions metafields --resource all --namespace custom --source shopA --target shopB
  metasync definitions metafields --resource product --namespace all --source shopA --target shopB
  metasync definitions metafields --resource all --namespace all --source shopA --target shopB
  metasync definitions metafields --resource product --namespace custom1,custom2,custom3 --source shopA --target shopB
  metasync definitions metafields --resource product --namespace custom --delete --live --source shopA --target shopB
  metasync definitions metaobject --type territory --source shopA --target shopB
  metasync data product --handle my-product --source shopA --target shopB --live
`;

  // Definitions command help text
  const definitionsHelpText = `
Metasync - Definitions Command

USAGE:
  metasync definitions metafields --resource <resource> --namespace <namespace> [options]
  metasync definitions metafields --resource all --namespace <namespace> [options]
  metasync definitions metaobject --type <type> [options]

COMMON OPTIONS:
  -h, --help            Display help
  --source <shop>        Source shop name (must exist in .shops.json)
  --target <shop>        Target shop name (defaults to source if not specified)
  --live                 Make actual changes (default is dry run)
  --debug                Enable debug logging
  --limit <number>       Limit the number of items to process (default: 3)

COMMANDS:
  metafields            Sync metafield definitions
  metaobject            Sync metaobject definitions

Examples:
  metasync definitions metafields --resource product --namespace custom
  metasync definitions metafields --resource all --namespace custom
  metasync definitions metafields --resource product --namespace all
  metasync definitions metafields --resource all --namespace all
  metasync definitions metafields --resource product --namespace custom1,custom2,custom3
  metasync definitions metafields --resource product --namespace custom --delete --live
  metasync definitions metaobject --type territory
`;

  // Data command help text
  const dataHelpText = `
Metasync - Data Command

USAGE:
  metasync data <resource> [options]

COMMON OPTIONS:
  -h, --help            Display help
  --source <shop>        Source shop name (must exist in .shops.json)
  --target <shop>        Target shop name (defaults to source if not specified)
  --live                 Make actual changes (default is dry run)
  --debug                Enable debug logging
  --limit <number>       Limit the number of items to process (default: 3)

COMMANDS:
  products              Sync product data
  metaobjects           Sync metaobject data
  pages                 Sync page data
  collections           Sync collection data
  customers             Sync customer data
  orders                Sync order data
  variants              Sync variant data

Examples:
  metasync data products --handle my-product --source shopA --target shopB
  metasync data metaobjects --type territory --source shopA --target shopB
`;

  // Configure help for the different contexts
  if (!isDataCommand && !isDefinitionsCommand) {
    customizeHelp(program, globalHelpText);
  }

  // Definitions command
  const defineCommand = program
    .command("definitions")
    .description("Sync only the definitions, not the data");

  if (isDefinitionsCommand) {
    customizeHelp(defineCommand, definitionsHelpText);
  }

  // Define subcommands
  const defineMetafieldsCmd = defineCommand
    .command("metafields")
    .description("Sync metafield definitions")
    .option("--resource <type>", "Type of resource (product, company, order, variant, customer, or 'all' for all types)")
    .option("--namespace <namespace>", "Namespace to sync (use 'all' to sync all namespaces, or comma-separated list for multiple namespaces)")
    .option("--key <key>", "Specific definition key to sync (e.g., 'namespace.key' - optional if --namespace is used)")
    .option("--delete", "Delete mode: removes all metafield definitions from target store (ignores source store)", false)
    .action((cmdOptions) => {
      // Merge command options with main options
      Object.assign(mergedOptions, cmdOptions);
      // Set command type
      mergedOptions.command = "definitions";
      // Don't default to product anymore
    });

  const defineMetaobjectsCmd = defineCommand
    .command("metaobject")
    .description("Sync metaobject definitions")
    .option("--type <type>", "Specific metaobject definition type to sync (e.g., 'my_app.my_def')")
    .action((cmdOptions) => {
      // Merge command options with main options
      Object.assign(mergedOptions, cmdOptions);
      // Set command type
      mergedOptions.command = "definitions";
      mergedOptions.resource = "metaobject";
      // Map type to key for backwards compatibility
      if (cmdOptions.type) {
        mergedOptions.key = cmdOptions.type;
      }
    });

  // Add common options to define subcommands
  addCommonOptions(defineMetafieldsCmd);
  addCommonOptions(defineMetaobjectsCmd);

  // Data command
  const dataCommand = program
    .command("data")
    .description("Sync data for specified resources (no definitions)");

  if (isDataCommand) {
    customizeHelp(dataCommand, dataHelpText);
  }

  // Define resources and their options for data commands
  const resourceSingular = ["product", "metaobject", "page", "collection", "customer", "order", "variant"];
  const resourcePlural = ["products", "metaobjects", "pages", "collections", "customers", "orders", "variants"];

  resourcePlural.forEach((pluralResource, index) => {
    const singularResource = resourceSingular[index];
    const cmd = dataCommand
      .command(pluralResource)
      .description(`Sync ${singularResource} data`);

    // Add resource-specific options
    if (pluralResource === "products") {
      cmd.option("--handle <handle>", "Product handle to sync")
         .option("--id <id>", "Product ID to sync")
         .option("--namespace <namespace>", "Sync only metafields with this namespace")
         .option("--key <key>", "Sync only metafields with this key (format: 'key' or 'namespace.key')")
         .option("--force-recreate", "Delete and recreate products instead of updating", false)
         .option("--batch-size <size>", "Number of products to process in each batch", 25)
         .option("--start-cursor <cursor>", "Pagination cursor to start from (for resuming interrupted syncs)");

      const productHelpText = `
Example: metasync data products --handle my-product --source shopA --target shopB

Options:
  --handle <handle>       Product handle to sync
  --id <id>               Product ID to sync
  --namespace <namespace> Sync only metafields with this namespace
  --key <key>             Sync only metafields with this key
  --force-recreate        Delete and recreate products instead of updating
  --batch-size <size>     Number of products to process in each batch
  --start-cursor <cursor> Pagination cursor for resuming interrupted syncs
`;
      customizeHelp(cmd, productHelpText);
    } else if (pluralResource === "metaobjects") {
      cmd.option("--type <type>", "Metaobject definition type to sync (required)")
         .option("--handle <handle>", "Metaobject handle to sync");

      const metaobjectHelpText = `
Example: metasync data metaobjects --type territory --source shopA --target shopB

Options:
  --type <type>           Metaobject definition type to sync (required)
  --handle <handle>       Metaobject handle to sync
      `;
      customizeHelp(cmd, metaobjectHelpText);
    } else if (pluralResource === "pages") {
      cmd.option("--handle <handle>", "Page handle to sync")
         .option("--id <id>", "Page ID to sync");

      const pageHelpText = `
Options:
  --handle <handle>       Page handle to sync
  --id <id>               Page ID to sync
      `;
      customizeHelp(cmd, pageHelpText);
    } else if (pluralResource === "collections") {
      cmd.option("--handle <handle>", "Collection handle to sync")
         .option("--id <id>", "Collection ID to sync")
         .option("--skip-automated", "Skip automated (smart) collections", false);

      const collectionHelpText = `
Example: metasync data collections --handle my-collection --source shopA --target shopB

Options:
  --handle <handle>       Collection handle to sync
  --id <id>               Collection ID to sync
  --skip-automated        Skip automated (smart) collections
      `;
      customizeHelp(cmd, collectionHelpText);
    } else {
      // Generic help for other resource types
      const genericHelpText = `
Usage: metasync data ${pluralResource} [options]

Sync ${singularResource} data
      `;
      customizeHelp(cmd, genericHelpText);
    }

    // Add action
    cmd.action((cmdOptions) => {
      // Merge command options with main options
      Object.assign(mergedOptions, cmdOptions);
      // Map plural resource back to singular for backwards compatibility
      mergedOptions.resource = singularResource;

      // Set command type
      mergedOptions.command = "data";

      // Map type to key for metaobjects (for backwards compatibility)
      if (singularResource === "metaobject" && cmdOptions.type) {
        mergedOptions.key = cmdOptions.type;
      }
    });

    // Add common options
    addCommonOptions(cmd);
  });

  // Add "all" command to sync all resource types
  const allCmd = dataCommand
    .command("all")
    .description("Sync all resource types at once")
    .option("--batch-size <size>", "Number of items to process in each batch", 25)
    .action((cmdOptions) => {
      // Merge command options with main options
      Object.assign(mergedOptions, cmdOptions);
      // Set command type to data
      mergedOptions.command = "data";
      // Set special resource type for all
      mergedOptions.resource = "all";
    });

  // Add common options to all command
  addCommonOptions(allCmd);

  const allHelpText = `
Example: metasync data all --source shopA --target shopB --live

Syncs data for all supported resource types including:
- Products data
- Metaobjects data
- Pages data
- Collections data
- Customers data
- Orders data
- Variants data

Note: This command only syncs data, not definitions. For metaobjects, ensure definitions
are synced first using: metasync definitions metaobject

Options:
  --batch-size <size>     Number of items to process in each batch
`;
  customizeHelp(allCmd, allHelpText);

  // For legacy support, show new command structure if someone uses older commands
  program
    .on('command:*', function (operands) {
      const availableCommands = program.commands.map(cmd => cmd.name());
      logger.error(`Error: unknown command '${operands[0]}'`);
      logger.info(`Available commands: ${availableCommands.join(', ')}`);
      process.exit(1);
    });

  program.parse(process.argv);

  // If no options have been merged from subcommands, we might be in a direct command
  // Get any options directly from the program
  const programOptions = program.opts();
  Object.assign(mergedOptions, programOptions);

  // For legacy support, show new command structure if someone uses older commands
  if (program.args.length > 0 && !mergedOptions.command) {
    logger.warn(`Note: Command structure has changed. Try using one of these commands instead:`);
    logger.info(`  metasync definitions metafields --resource <resource> --namespace <namespace>`);
    logger.info(`  metasync definitions metaobject --type <type>`);
    logger.info(`  metasync data products|metaobjects|pages [options]`);
  }

  return mergedOptions;
}

module.exports = {
  setupCommandLineOptions
};
