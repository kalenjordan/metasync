# Metaobject Sync CLI

A command-line tool to sync Shopify metaobject definitions and data between stores.

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

Display available metaobject types:
```
node run.js --source my-dev-shop
```

Sync a specific metaobject type from one store to another (dry run by default):
```
node run.js --source my-dev-shop --target my-test-shop --type email_templates
```

To actually perform the changes, add the `--not-a-drill` flag:
```
node run.js --source my-dev-shop --target my-test-shop --type custom.my_metaobject_type --not-a-drill
```

## Options

- `--source <name>`: Source shop name (must exist in .shops.json) [required]
- `--target <name>`: Target shop name (must exist in .shops.json). Defaults to source shop if not specified
- `--type <type>`: Specific metaobject definition type to sync (if not specified, will display available types and exit)
- `--definitions-only`: Sync only the metaobject definitions, not the data
- `--data-only`: Sync only the metaobject data, not the definitions
- `--not-a-drill`: Make actual changes (default is dry run)
- `--debug`: Enable debug logging

## Safety Features

- By default, the tool runs in "dry run" mode, showing what would happen without making changes
- Cannot use target shops with "production" or "prod" in the name for safety
- Full logging during synchronization process

## Example Use Cases

- Copy metaobject definitions from development to test environment
- Copy test data from one store to another
- Back up metaobject data by copying to a development store
