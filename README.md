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

## Real-World Examples

### Viewing Available Metaobject Types

```
➜  metasync git:(main) ✗ node run.js --source production-store-redacted --target tapestry-dev
Dry Run: Yes (no changes will be made)
Debug: Disabled

No metaobject type specified. Fetching available types...

Available metaobject types:
- member_roles (Roles)
- territory (Territories)
- shopify--color-pattern (Color)
- shopify--bedding-size (Bedding size)
- sales_rep_zip_code_mapping (Sales Rep Zip Code Mapping)
- app--6171699--shopify-forms297263 (claims-form)
- email_templates (Email Templates)
- shopify--fabric (Fabric)
- global_swatches (Global Swatches)
- promos (Promos)

Please run the command again with --type <type> to specify which metaobject type to sync.
```

### Dry Run - Seeing What Changes Would Be Made

```
➜  metasync git:(main) ✗ node run.js --source production-store-redacted --target tapestry-dev --type email_templates
Dry Run: Yes (no changes will be made)
Debug: Disabled

Found 1 metaobject definition(s) in source shop for type: email_templates
Found 1 metaobject definition(s) in target shop
Creating metaobject definition: email_templates
[DRY RUN] Would create metaobject definition email_templates
Syncing metaobjects for type: email_templates
Found 6 metaobject(s) in source shop for type email_templates
Found 0 metaobject(s) in target shop for type email_templates
Creating metaobject: account-application-declined
[DRY RUN] Would create metaobject account-application-declined with 3 fields
Creating metaobject: account-application-approved
[DRY RUN] Would create metaobject account-application-approved with 3 fields
Creating metaobject: registration-confirmation
[DRY RUN] Would create metaobject registration-confirmation with 3 fields
Creating metaobject: default-territory-notification
[DRY RUN] Would create metaobject default-territory-notification with 3 fields
Creating metaobject: project-collaboration-invite
[DRY RUN] Would create metaobject project-collaboration-invite with 3 fields
Creating metaobject: project-note-notification
[DRY RUN] Would create metaobject project-note-notification with 3 fields

Sync completed:
Metaobject Definitions: 1 created, 0 updated, 0 failed
Metaobject Data: 6 created, 0 updated, 0 failed
```

### Actual Sync With Changes

```
➜  metasync git:(main) ✗ node run.js --source production-store-redacted --target tapestry-dev --type email_templates --not-a-drill
Dry Run: No (changes will be made)
Debug: Disabled

Found 1 metaobject definition(s) in source shop for type: email_templates
Found 1 metaobject definition(s) in target shop
Creating metaobject definition: email_templates
Syncing metaobjects for type: email_templates
Found 6 metaobject(s) in source shop for type email_templates
Found 0 metaobject(s) in target shop for type email_templates
Creating metaobject: account-application-declined
Creating metaobject: account-application-declined with 3 fields
Creating metaobject: account-application-approved
Creating metaobject: account-application-approved with 3 fields
Creating metaobject: registration-confirmation
Creating metaobject: registration-confirmation with 3 fields
Creating metaobject: default-territory-notification
Creating metaobject: default-territory-notification with 3 fields
Creating metaobject: project-collaboration-invite
Creating metaobject: project-collaboration-invite with 3 fields
Creating metaobject: project-note-notification
Creating metaobject: project-note-notification with 3 fields

Sync completed:
Metaobject Definitions: 1 created, 0 updated, 0 failed
Metaobject Data: 6 created, 0 updated, 0 failed
```
