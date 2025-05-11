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
    "accessToken": "shpat_example_token_for_dev_shop"
  },
  {
    "name": "my-test-shop",
    "domain": "my-test-shop.myshopify.com",
    "accessToken": "shpat_example_token_for_test_shop"
  }
]
```

Replace the example values with your actual shop names, domains, and access tokens. You'll need an access token with appropriate permissions for the resources you want to sync.

## Usage

MetaSync has two main commands:

- `define` - Sync definitions only (metaobject definitions, metafield definitions)
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
metasync data product --source my-dev-shop --target my-test-shop

# Apply changes with --live flag
metasync data product --source my-dev-shop --target my-test-shop --live

# Sync multiple namespaces at once using comma-separated values
metasync definitions metafields --resource product --namespace custom1,custom2,custom3 --source my-dev-shop --target my-test-shop
```

For detailed command options and more examples, use the built-in help:

```sh
metasync --help
```

## Safety Features

- By default, the tool runs in "dry run" mode, showing what would happen without making changes
- Cannot use target shops with "production" or "prod" in the name for safety
- Full logging during synchronization process

## ISSUES

Variant option images aren't being uploaded properly upon create, but upon update they are.
