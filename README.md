# MetaSync CLI

A command-line tool to sync Shopify metaobject definitions, metafield definitions, and resource data between stores.

## Installation

1. Clone this repository
2. Install dependencies:
```sh
npm install
```
3. Make the CLI globally available:
```sh
npm link
```

## Configuration

Create a `.shops.json` file in the root directory based on the provided `.shops.json.example` file:

```json
[
  {
    "name": "my-dev-shop",
    "domain": "my-dev-shop.myshopify.com",
    "accessToken": "shpat_example_token_for_dev_shop",
    "protected": false
  },
  {
    "name": "my-test-shop",
    "domain": "my-test-shop.myshopify.com",
    "accessToken": "shpat_example_token_for_test_shop"
  }
]
```

Replace the example values with your actual shop names, domains, and access tokens. You'll need an access token with appropriate permissions for the resources you want to sync.

### Shop Protection

By default, all shops are protected from accidental modifications. To allow changes to be made to a shop, you must explicitly set `"protected": false` in your `.shops.json` file for that shop:

```json
{
  "name": "my-shop",
  "domain": "my-shop.myshopify.com",
  "accessToken": "shpat_access_token",
  "protected": false  // Must be set to false to allow writes
}
```

If a shop is protected and you try to make changes with the `--live` flag, the tool will exit with an error.

## Usage

MetaSync has two main commands:

- `definitions` - Sync definitions only (metaobject definitions, metafield definitions)
- `data` - Sync data only (products, metaobjects, pages)

### Common Options

All commands accept these common options:

- `--source <shop>` - Source shop name (must exist in .shops.json) [required]
- `--target <shop>` - Target shop name (defaults to source shop if not specified)
- `--live` - Make actual changes (default is dry run)
- `--debug` - Enable debug logging
- `--limit <number>` - Limit the number of items to process per run (default: 3)

### Basic Example

```sh
# Sync product data from dev shop to test shop (dry run mode)
metasync data products --source my-dev-shop --target my-test-shop

# Apply changes with --live flag
metasync data products --source my-dev-shop --target my-test-shop --live

# Sync multiple namespaces at once using comma-separated values
metasync definitions metafields --resource product --namespace custom1,custom2,custom3 --source my-dev-shop --target my-test-shop

# Delete mode: remove all metafield definitions from target store
metasync definitions metafields --resource product --namespace custom --delete --live --source my-dev-shop --target my-test-shop
```

For detailed command options and more examples, use the built-in help:

```sh
metasync --help
```

## Safety Features

- By default, the tool runs in "dry run" mode, showing what would happen without making changes
- All shops are protected by default, requiring explicit `"protected": false` in `.shops.json` to allow modifications
- Cannot use target shops with "production" or "prod" in the name for safety
- Full logging during synchronization process

## ISSUES

Variant option images aren't being uploaded properly upon create, but upon update they are.
