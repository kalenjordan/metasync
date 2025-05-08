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

### Command Structure

```
metasync
├─ define                            # Define/sync definitions only
│  ├─ metafields [options]           # Sync metafield definitions
│  └─ metaobject [options]           # Sync metaobject definitions
└─ data                              # Sync resource data
   ├─ product [options]              # Sync product data
   ├─ metaobject [options]           # Sync metaobject data
   ├─ page [options]                 # Sync page data
   ├─ customer [options]             # Sync customer data
   ├─ order [options]                # Sync order data
   └─ variant [options]              # Sync variant data
```

### Common Options

All commands accept these common options:

- `--source <shop>` - Source shop name (must exist in .shops.json) [required]
- `--target <shop>` - Target shop name (defaults to source shop if not specified)
- `--live` - Make actual changes (default is dry run)
- `--debug` - Enable debug logging
- `--limit <number>` - Limit the number of items to process per run (default: 3)

### Examples

**List Available Metaobject Types:**
```sh
metasync define metaobject --source my-dev-shop
```

**Sync Metaobject Definitions:**
```sh
metasync define metaobject --type custom.my_type --source my-dev-shop --target my-test-shop
```

**List Available Metafield Namespaces for Products:**
```sh
metasync define metafields --resource product --source my-dev-shop
```

**Sync Product Metafield Definitions:**
```sh
metasync define metafields --resource product --namespace custom --source my-dev-shop --target my-test-shop
```

**Sync Product Data:**
```sh
metasync data product --source my-dev-shop --target my-test-shop [--handle my-product] [--live]
```

**Sync Metaobject Data:**
```sh
metasync data metaobject --type custom.my_type --source my-dev-shop --target my-test-shop
```

**Sync Page Data:**
```sh
metasync data page --source my-dev-shop --target my-test-shop
```

## Safety Features

- By default, the tool runs in "dry run" mode, showing what would happen without making changes
- Cannot use target shops with "production" or "prod" in the name for safety
- Full logging during synchronization process

## Help

For detailed help and options for each command:

```sh
metasync --help
metasync define --help
metasync define metafields --help
metasync define metaobject --help
metasync data --help
metasync data product --help
metasync data metaobject --help
```

## ISSUES

Variant option images aren't being uploaded properly upon create, but upon update they are.
