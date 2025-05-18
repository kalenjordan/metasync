# MetaSync CLI

A command-line tool to synchronize Shopify metaobject definitions, metafield definitions and resource data between stores.

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

Replace the example values with your actual shop names, domains and access tokens. You'll need an access token with the necessary permissions for the resources you want to sync.

### Shop Protection

By default all shops are protected from accidental modifications. To allow changes to be made to a shop you must explicitly set `"protected": false` in your `.shops.json` file for that shop:

```json
{
  "name": "my-shop",
  "domain": "my-shop.myshopify.com",
  "accessToken": "shpat_access_token",
  "protected": false
}
```

If a shop is protected and you try to make changes with the `--live` flag the tool will exit with an error.

## Usage

MetaSync has two top‑level commands:

- `definitions` – sync only the definitions (metaobjects or metafield definitions)
- `data` – sync resource data only

### Common Options

All commands accept the following options:

- `--source <shop>` – Source shop name (required)
- `--target <shop>` – Target shop name (defaults to source if not specified)
- `--live` – Make actual changes (default is dry run)
- `--debug` – Enable debug logging
- `--limit <number>` – Limit the number of items to process (default: 3)
- `--batch-size <number>` – Batch size for pagination (default: 25)

### Definition Commands

```
metasync definitions metafields --resource <resource> --namespace <namespace> [options]
metasync definitions metaobjects --type <type> [options]
```

Options for `metafields`:

- `--resource <type>` – Resource type (products, companies, orders, variants, customers, collections or `all`)
- `--namespace <namespace>` – Namespace to sync (`all` or comma separated list)
- `--key <key>` – Specific definition key (`namespace.key`)
- `--delete` – Delete mode, remove definitions from the target store

Options for `metaobjects`:

- `--type <type>` – Metaobject definition type to sync

### Data Commands

```
metasync data <resource> [options]
```

Supported resources: `products`, `metaobjects`, `pages`, `collections`, `customers`, `orders`, `variants`, or `all` to sync everything in one run.

Resource‑specific options:

**products**
- `--handle <handle>` – Sync a single product by handle
- `--id <id>` – Sync a single product by ID
- `--namespace <namespace>` – Sync only metafields in this namespace
- `--key <key>` – Sync only metafields with this key
- `--force-recreate` – Delete and recreate products instead of updating
- `--delete` – Remove matching products from the target store
- `--batch-size <size>` – Number of products per batch (default: 25)
- `--start-cursor <cursor>` – Pagination cursor for resuming interrupted syncs

**metaobjects**
- `--type <type>` – Metaobject definition type to sync (required)
- `--handle <handle>` – Sync a single metaobject by handle
- `--delete` – Remove matching metaobjects from the target store

**pages**, **collections**, **customers**, **orders**, **variants**
- `--handle <handle>` / `--id <id>` (where applicable)
- `--type <type>` for collections (`manual` or `smart`)
- `--delete` – Remove matching resources from the target store

The `data all` command accepts `--batch-size` to control pagination across all resources.

### Examples

```sh
# Dry run product sync between shops
metasync data products --source my-dev-shop --target my-test-shop

# Apply changes
metasync data products --source my-dev-shop --target my-test-shop --live

# Sync multiple namespaces at once
metasync definitions metafields --resource products --namespace custom1,custom2 --source my-dev-shop --target my-test-shop

# Delete metafield definitions from target
metasync definitions metafields --resource products --namespace custom --delete --live --source my-dev-shop --target my-test-shop

# Sync a single metaobject by handle
metasync data metaobjects --type blog --handle introduction --source my-dev-shop --target my-test-shop --live

# Limit number of products and enable debug logging
metasync data products --source my-dev-shop --target my-test-shop --limit 10 --debug

# Resume product sync from a saved cursor
metasync data products --source my-dev-shop --target my-test-shop --start-cursor <cursor> --live
```

For additional examples and the most up‑to‑date options run `metasync --help`.

## Safety Features

- Runs in dry run mode by default
- Shops are protected by default and require `"protected": false` to allow writes
- Full logging of all synchronization actions

## ISSUES

Variant option images aren't being uploaded properly upon create, but upon update they are.
