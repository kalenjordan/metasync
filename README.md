# Meta Sync CLI

A command-line tool to sync Shopify metaobject definitions and data, or metafield definitions for various resources, between stores.

## Installation

1. Clone this repository
2. Install dependencies:
```
npm install
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

Replace the example values with your actual shop names, domains, and access tokens. You'll need an access token with permissions to read and write metaobjects.

## Usage

**Metaobjects**

Display available metaobject types:
```sh
node run.js --source my-dev-shop --resource metaobjects
```

Sync a specific metaobject type definition and data from one store to another (dry run by default):
```sh
node run.js --source my-dev-shop --target my-test-shop --resource metaobjects --key custom.my_metaobject_type
```

**Metafields**

Display available metafield namespaces for a specific resource type (e.g., product):
```sh
# This happens automatically if --namespace is omitted for a metafield resource
node run.js --source my-dev-shop --resource product
```

Sync metafield definitions for a specific namespace and resource type (dry run by default):
```sh
node run.js --source my-dev-shop --target my-test-shop --resource product --namespace my_fields
```

Sync a single metafield definition (dry run by default):
```sh
node run.js --source my-dev-shop --target my-test-shop --resource product --namespace my_fields --key my_fields.material
```

**Making Changes**

To actually perform the changes for any resource type, add the `--not-a-drill` flag:
```sh
# Example: Sync product metafields in the 'my_fields' namespace
node run.js --source my-dev-shop --target my-test-shop --resource product --namespace my_fields --not-a-drill

# Example: Sync a specific metaobject type
node run.js --source my-dev-shop --target my-test-shop --resource metaobjects --key custom.my_metaobject_type --not-a-drill
```

## Options

- `--source <name>`: Source shop name (must exist in .shops.json) [required]
- `--target <name>`: Target shop name (must exist in .shops.json). Defaults to source shop if not specified
- `--resource <type>`: Type of resource to sync (`metaobjects`, `product`, `company`, `order`, `variant`, `customer`, `page`) [required]
- `--key <key>`: Specific definition key/type to sync (e.g., 'my_app.my_def' for metaobjects, 'namespace.key' for metafields). Optional for metafields if syncing a whole namespace.
- `--namespace <namespace>`: Namespace to sync (required for metafield resources: `product`, `company`, `order`, `variant`, `customer`). If omitted, available namespaces for the resource will be listed.
- `--definitions-only`: Sync only the definitions, not the data (currently only metaobject data sync is supported)
- `--data-only`: Sync only the data, not the definitions (currently only metaobject data sync is supported)
- `--not-a-drill`: Make actual changes (default is dry run)
- `--debug`: Enable debug logging
- `--limit <number>`: Limit the number of items (definitions or data entries) to process per run (default: 3)

## Safety Features

- By default, the tool runs in "dry run" mode, showing what would happen without making changes
- Cannot use target shops with "production" or "prod" in the name for safety
- Full logging during synchronization process

## Example Use Cases

- Copy metaobject definitions and data from development to test environment
- Back up metaobject data by copying to a development store
- Copy pages between stores to maintain consistent content

## Real-World Examples

### Viewing Available Metaobject Types

```sh
➜  metasync git:(main) ✗ node run.js --source my-dev-shop --resource metaobjects
ℹ Syncing Resource Type: metaobjects
ℹ Dry Run: Yes (no changes will be made)
ℹ Debug: Disabled
ℹ Limit: 3
ℹ No specific metaobject type specified (--key). Fetching available types...

Available metaobject definition types:
- custom.my_metaobject_type (My Metaobject)
- shopify--some_standard_type (Standard Type)

Please run the command again with --key <type> to specify which metaobject type to sync.
```

### Viewing Available Metafield Namespaces (for Products)

```sh
➜  metasync git:(main) ✗ node run.js --source my-dev-shop --resource product
ℹ Syncing Resource Type: product
ℹ Dry Run: Yes (no changes will be made)
ℹ Debug: Disabled
ℹ Limit: 3
ℹ Fetching all available product metafield definitions... (Triggered because --namespace was not specified)

Available product metafield namespaces/keys:
- custom.material (Material)
- custom.care_instructions (Care Instructions)
- shopify--discovery--product_highlight.value (Product Highlight)

Please run the command again with --namespace <namespace> to specify which product metafield namespace to sync.
```

### Dry Run - Syncing Product Metafield Definitions

```sh
➜  metasync git:(main) ✗ node run.js --source my-dev-shop --target my-test-shop --resource product --namespace custom
ℹ Syncing Resource Type: product
ℹ Dry Run: Yes (no changes will be made)
ℹ Debug: Disabled
ℹ Limit: 3
ℹ Syncing product metafield definitions...
ℹ Found 2 definition(s) in source for namespace custom
ℹ Found 0 definition(s) in target (for namespace: custom)
ℹ Creating product metafield definition: custom.material
ℹ [DRY RUN] Would create product metafield definition custom.material
ℹ Creating product metafield definition: custom.care_instructions
ℹ [DRY RUN] Would create product metafield definition custom.care_instructions
✔ Finished syncing product metafield definitions.
✔ Sync completed:
ℹ Product Metafield Definitions: 2 created, 0 updated, 0 failed
```

### Dry Run - Syncing Metaobjects (Definitions and Data)

```sh
➜  metasync git:(main) ✗ node run.js --source my-dev-shop --target my-test-shop --resource metaobjects --key custom.my_metaobject_type
ℹ Syncing Resource Type: metaobjects
ℹ Dry Run: Yes (no changes will be made)
ℹ Debug: Disabled
ℹ Limit: 3
ℹ Syncing metaobject definitions for type: custom.my_metaobject_type...
ℹ Found 1 definition(s) in source for type custom.my_metaobject_type
ℹ Found 0 definition(s) in target
ℹ Creating metaobject definition: custom.my_metaobject_type
ℹ [DRY RUN] Would create metaobject definition custom.my_metaobject_type
✔ Finished syncing metaobject definitions.
ℹ Syncing metaobject data for type: custom.my_metaobject_type...
ℹ Found 2 metaobject(s) in source shop for type custom.my_metaobject_type
ℹ Found 0 metaobject(s) in target shop for type custom.my_metaobject_type
ℹ Creating metaobject: First Object
ℹ [DRY RUN] Would create metaobject First Object with 2 fields
ℹ Creating metaobject: Second Object
ℹ [DRY RUN] Would create metaobject Second Object with 2 fields
✔ Finished syncing metaobject data.
✔ Sync completed:
ℹ Metaobject Definitions: 1 created, 0 updated, 0 failed
ℹ Metaobject Data: 2 created, 0 updated, 0 failed
```

### Actual Sync With Changes (Product Metafields)

```sh
➜  metasync git:(main) ✗ node run.js --source my-dev-shop --target my-test-shop --resource product --namespace custom --not-a-drill
ℹ Syncing Resource Type: product
ℹ Dry Run: No (changes will be made)
ℹ Debug: Disabled
ℹ Limit: 3
ℹ Syncing product metafield definitions...
ℹ Found 2 definition(s) in source for namespace custom
ℹ Found 0 definition(s) in target (for namespace: custom)
ℹ Creating product metafield definition: custom.material
ℹ Creating product metafield definition: custom.care_instructions
✔ Finished syncing product metafield definitions.
✔ Sync completed:
ℹ Product Metafield Definitions: 2 created, 0 updated, 0 failed
```

### Syncing Pages Between Stores

```sh
# List available pages from source store
node run.js --source my-dev-shop --resource page

# Perform a dry run of syncing pages
node run.js --source my-dev-shop --target my-test-shop --resource page

# Actually sync pages from source to target
node run.js --source my-dev-shop --target my-test-shop --resource page --not-a-drill
```

### Dry Run - Syncing Pages

```sh
➜  metasync git:(main) ✗ node run.js --source my-dev-shop --target my-test-shop --resource page
ℹ Syncing Resource Type: page
ℹ Dry Run: Yes (no changes will be made)
ℹ Debug: Disabled
ℹ Limit: 3
ℹ Found 2 page(s) in source shop
ℹ Found 0 page(s) in target shop
ℹ Creating page: About Us
ℹ [DRY RUN] Would create page "About Us"
ℹ Creating page: Contact
ℹ [DRY RUN] Would create page "Contact"
✔ Finished syncing pages.
✔ Sync completed:
ℹ Pages: 2 created, 0 updated, 0 skipped, 0 failed
```
