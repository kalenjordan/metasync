#!/usr/bin/env node

// Check for --prod flag before loading environment variables
const isProd = process.argv.includes("--prod");
const path = require("path");
const fs = require("fs");
const { program } = require("commander");
const Shopify = require('shopify-api-node');

/**
 * Get shop configuration from .shops.json file by shop name
 *
 * .shops.json format:
 * [
 *   {
 *     "name": "shop1",
 *     "domain": "shop1.myshopify.com",
 *     "accessToken": "shpat_123456789"
 *   },
 *   {
 *     "name": "shop2",
 *     "domain": "shop2.myshopify.com",
 *     "accessToken": "shpat_987654321"
 *   }
 * ]
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
    console.error('Error reading .shops.json:', error.message);
    return null;
  }
}

class MetaobjectSyncCli {
  constructor(options = {}) {
    this.options = options;
    this.isProd = isProd;
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
    this.sourceShopifyClient = new Shopify({
      shopName: sourceShopConfig.domain.replace('.myshopify.com', ''),
      accessToken: sourceShopConfig.accessToken,
      apiVersion: '2023-07',
      autoLimit: this.options.debug ? false : true
    });

    this.targetShopifyClient = new Shopify({
      shopName: targetShopConfig.domain.replace('.myshopify.com', ''),
      accessToken: targetShopConfig.accessToken,
      apiVersion: '2023-07',
      autoLimit: this.options.debug ? false : true
    });

    // Add event listeners for call limits if debug is enabled
    if (this.options.debug) {
      this.sourceShopifyClient.on('callLimits', limits => console.log('Source shop call limits:', limits));
      this.sourceShopifyClient.on('callGraphqlLimits', limits => console.log('Source shop GraphQL limits:', limits));
      this.targetShopifyClient.on('callLimits', limits => console.log('Target shop call limits:', limits));
      this.targetShopifyClient.on('callGraphqlLimits', limits => console.log('Target shop GraphQL limits:', limits));
    }
  }

  static setupCommandLineOptions() {
    program
      .description("Sync metaobject definitions and data between Shopify stores")
      .option("--source <name>", "Source shop name (must exist in .shops.json)")
      .option("--target <name>", "Target shop name (must exist in .shops.json). Defaults to source shop if not specified")
      .option("--type <type>", "Specific metaobject definition type to sync (if not specified, will display available types and exit)")
      .option("--definitions-only", "Sync only the metaobject definitions, not the data")
      .option("--data-only", "Sync only the metaobject data, not the definitions")
      .option("--prod", "Use production environment (.env.production)")
      .option("--not-a-drill", "Make actual changes (default is dry run)", false)
      .option("--debug", "Enable debug logging", false)
      .parse(process.argv);

    return program.opts();
  }

  async fetchMetaobjectDefinitions(client, type = null) {
    const query = `#graphql
      query {
        metaobjectDefinitions(first: 100) {
          nodes {
            id
            type
            name
            description
            fieldDefinitions {
              key
              name
              description
              required
              type {
                name
              }
              validations {
                name
                value
              }
            }
            capabilities {
              publishable {
                enabled
              }
            }
            access {
              admin
              storefront
            }
          }
        }
      }
    `;

    const response = await client.graphql(query);
    const definitions = response.metaobjectDefinitions.nodes;

    // If a specific type is requested, filter the results
    if (type) {
      return definitions.filter(def => def.type === type);
    }

    return definitions;
  }

  /**
   * Extract field type name from a field definition
   * Handles both new format and old format field types
   * @param {Object} field - The field definition object
   * @returns {string} The field type name
   */
  getFieldTypeName(field) {
    // If field.type is a string, use it directly
    if (typeof field.type === 'string') {
      return field.type;
    }

    // If field.type is an object with a name property, use that
    if (field.type && field.type.name) {
      return field.type.name;
    }

    // Default fallback
    return 'single_line_text_field';
  }

  /**
   * Processes a field definition to extract special properties and convert to the format expected by the API
   * @param {Object} field - The field definition object
   * @returns {Object} The processed field definition
   */
  processFieldDefinition(field) {
    const typeName = this.getFieldTypeName(field);

    const fieldDef = {
      key: field.key,
      name: field.name,
      description: field.description || "",
      required: field.required,
      type: typeName,
      validations: field.validations || []
    };

    // Add special properties for specific field types
    if (typeName === "metaobject_reference" && field.type?.supportedTypes) {
      fieldDef.validations.push({
        name: "metaobject_definition",
        value: JSON.stringify({ types: field.type.supportedTypes })
      });
    }

    if (typeName === "rating" && field.type?.outOfRange) {
      fieldDef.validations.push({
        name: "range",
        value: JSON.stringify({ min: "0", max: field.type.outOfRange })
      });
    }

    if (typeName === "list" && field.type?.validationRules?.allowedValues) {
      fieldDef.validations.push({
        name: "allowed_values",
        value: JSON.stringify(field.type.validationRules.allowedValues)
      });
    }

    return fieldDef;
  }

  async createMetaobject(client, metaobject, definitionType) {
    // Convert fields to the format expected by the API and filter out null values
    const fields = metaobject.fields
      .filter(field => field.value !== null && field.value !== undefined)
      .map(field => ({
        key: field.key,
        value: field.value || "" // Ensure empty string instead of null/undefined
      }));

    const input = {
      type: definitionType,
      fields,
      capabilities: metaobject.capabilities || {}
    };

    if (metaobject.handle) {
      input.handle = metaobject.handle;
    }

    // Note: displayName is not supported in MetaobjectCreateInput
    // It may be set in the field values instead

    const mutation = `#graphql
      mutation createMetaobject($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject {
            id
            handle
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    if (this.options.notADrill) {
      // Log the input for better debugging
      console.log(`Creating metaobject: ${metaobject.handle || 'unknown'} with ${fields.length} fields`);
      if (this.debug) {
        console.log({
          action: 'createMetaobject',
          handle: metaobject.handle || 'unknown',
          type: definitionType,
          fieldCount: fields.length,
          fields: fields.map(f => ({ key: f.key, valueLength: f.value ? f.value.length : 0 }))
        });
      }

      const result = await client.graphql(mutation, { metaobject: input });

      if (result.metaobjectCreate.userErrors.length > 0) {
        const errors = result.metaobjectCreate.userErrors;
        throw new Error(`Failed to create metaobject ${metaobject.handle || 'unknown'}: ${JSON.stringify(errors)}`);
      }

      return result.metaobjectCreate.metaobject;
    } else {
      console.log(`[DRY RUN] Would create metaobject ${metaobject.handle || 'unknown'} with ${fields.length} fields`);
      if (this.debug) {
        console.log({
          action: 'dryRun',
          handle: metaobject.handle || 'unknown',
          type: definitionType,
          fieldCount: fields.length
        });
      }
      return { id: "dry-run-id", handle: metaobject.handle || "dry-run-handle" };
    }
  }

  async updateMetaobject(client, metaobject, existingMetaobject) {
    // Convert fields to the format expected by the API and filter out null values
    const fields = metaobject.fields
      .filter(field => field.value !== null && field.value !== undefined)
      .map(field => ({
        key: field.key,
        value: field.value || "" // Ensure empty string instead of null/undefined
      }));

    const input = {
      fields
    };

    // Note: displayName is not supported in MetaobjectUpdateInput

    const mutation = `#graphql
      mutation updateMetaobject($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject {
            id
            handle
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    if (this.options.notADrill) {
      const result = await client.graphql(mutation, {
        id: existingMetaobject.id,
        metaobject: input
      });

      if (result.metaobjectUpdate.userErrors.length > 0) {
        const errors = result.metaobjectUpdate.userErrors;
        throw new Error(`Failed to update metaobject ${metaobject.handle || 'unknown'}: ${JSON.stringify(errors)}`);
      }

      return result.metaobjectUpdate.metaobject;
    } else {
      console.log(`[DRY RUN] Would update metaobject ${metaobject.handle || 'unknown'}`);
      if (this.debug) {
        console.log({
          id: existingMetaobject.id,
          metaobject: input
        });
      }
      return { id: existingMetaobject.id, handle: metaobject.handle || existingMetaobject.handle };
    }
  }

  async createMetaobjectDefinition(client, definition) {
    // Convert the definition to the format expected by the API
    const input = {
      type: definition.type,
      name: definition.name,
      description: definition.description || "",
      fieldDefinitions: definition.fieldDefinitions.map(field => this.processFieldDefinition(field)),
      capabilities: definition.capabilities || {},
      access: definition.access || { admin: "MERCHANT_READ_WRITE", storefront: "PUBLIC_READ" }
    };

    const mutation = `#graphql
      mutation createMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
        metaobjectDefinitionCreate(definition: $definition) {
          metaobjectDefinition {
            id
            type
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    if (this.options.notADrill) {
      const result = await client.graphql(mutation, { definition: input });

      if (result.metaobjectDefinitionCreate.userErrors.length > 0) {
        const errors = result.metaobjectDefinitionCreate.userErrors;
        console.error(`Failed to create metaobject definition ${definition.type}: ${JSON.stringify(errors)}`);
        if (this.debug) {
          console.error({
            errors,
            definition: input,
            type: definition.type
          });
        }
        return null;
      }

      return result.metaobjectDefinitionCreate.metaobjectDefinition;
    } else {
      console.log(`[DRY RUN] Would create metaobject definition ${definition.type}`);
      if (this.debug) {
        console.log({ definition: input });
      }
      return { id: "dry-run-id", type: definition.type };
    }
  }

  async updateMetaobjectDefinition(client, definition, existingDefinition) {
    // Create a map of existing field definitions by key for quick lookup
    const existingFieldMap = {};
    if (existingDefinition.fieldDefinitions) {
      existingDefinition.fieldDefinitions.forEach(field => {
        existingFieldMap[field.key] = field;
      });
    }

    // Convert the field definitions to the format expected by the API
    const fieldDefinitions = definition.fieldDefinitions.map(field => {
      const fieldDef = this.processFieldDefinition(field);

      // If field already exists, use update operation, otherwise use create
      if (existingFieldMap[field.key]) {
        return {
          update: {
            key: fieldDef.key,
            name: fieldDef.name,
            description: fieldDef.description,
            required: fieldDef.required,
            validations: fieldDef.validations
          }
        };
      } else {
        return {
          create: {
            key: fieldDef.key,
            type: fieldDef.type,
            name: fieldDef.name,
            description: fieldDef.description,
            required: fieldDef.required,
            validations: fieldDef.validations
          }
        };
      }
    });

    // Convert the definition to the format expected by the API
    const input = {
      name: definition.name,
      description: definition.description || "",
      fieldDefinitions: fieldDefinitions,
      capabilities: definition.capabilities || {},
      access: definition.access || { admin: "MERCHANT_READ_WRITE", storefront: "PUBLIC_READ" }
    };

    const mutation = `#graphql
      mutation updateMetaobjectDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
        metaobjectDefinitionUpdate(id: $id, definition: $definition) {
          metaobjectDefinition {
            id
            type
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    if (this.options.notADrill) {
      const result = await client.graphql(mutation, {
        id: existingDefinition.id,
        definition: input
      });

      if (result.metaobjectDefinitionUpdate.userErrors.length > 0) {
        const errors = result.metaobjectDefinitionUpdate.userErrors;
        console.error(`Failed to update metaobject definition ${definition.type}: ${JSON.stringify(errors)}`);
        if (this.debug) {
          console.error({
            errors,
            id: existingDefinition.id,
            definition: input,
            type: definition.type
          });
        }
        return null;
      }

      return result.metaobjectDefinitionUpdate.metaobjectDefinition;
    } else {
      console.log(`[DRY RUN] Would update metaobject definition ${definition.type}`);
      if (this.debug) {
        console.log({ id: existingDefinition.id, definition: input });
      }
      return { id: existingDefinition.id, type: definition.type };
    }
  }

  async fetchMetaobjects(client, type) {
    const query = `#graphql
      query GetMetaobjects($type: String!) {
        metaobjects(type: $type, first: 100) {
          edges {
            node {
              id
              handle
              type
              displayName
              fields {
                key
                value
                type
                reference {
                  ... on Collection {
                    id
                    title
                    handle
                  }
                  ... on Product {
                    id
                    title
                    handle
                  }
                  ... on ProductVariant {
                    id
                    title
                  }
                  ... on Metaobject {
                    id
                    type
                    handle
                  }
                }
              }
              capabilities {
                publishable {
                  status
                }
              }
            }
          }
        }
      }
    `;

    const response = await client.graphql(query, { type });
    return response.metaobjects.edges.map(edge => edge.node);
  }

  async syncDefinitions() {
    // Always fetch all definitions and then filter by type if needed
    const sourceDefinitions = await this.fetchMetaobjectDefinitions(
      this.sourceShopifyClient,
      this.options.type
    );

    if (sourceDefinitions.length === 0) {
      if (this.options.type) {
        console.log(`No metaobject definitions found in source shop for type: ${this.options.type}`);
      } else {
        console.log(`No metaobject definitions found in source shop.`);
      }
      return { results: { created: 0, updated: 0, skipped: 0, failed: 0 }, definitionTypes: [] };
    }

    console.log(`Found ${sourceDefinitions.length} metaobject definition(s) in source shop${this.options.type ? ` for type: ${this.options.type}` : ''}`);

    const targetDefinitions = await this.fetchMetaobjectDefinitions(
      this.targetShopifyClient
    );

    console.log(`Found ${targetDefinitions.length} metaobject definition(s) in target shop`);

    // Create a map of target definitions by type for quick lookup
    const targetDefinitionMap = {};
    targetDefinitions.forEach(def => {
      targetDefinitionMap[def.type] = def;
    });

    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };

    // Process each source definition
    for (const definition of sourceDefinitions) {
      if (targetDefinitionMap[definition.type]) {
        // Definition exists in target, update it
        console.log(`Updating metaobject definition: ${definition.type}`);
        const updated = await this.updateMetaobjectDefinition(
          this.targetShopifyClient,
          definition,
          targetDefinitionMap[definition.type]
        );

        if (updated) {
          results.updated++;
        } else {
          results.failed++;
        }
      } else {
        // Definition doesn't exist in target, create it
        console.log(`Creating metaobject definition: ${definition.type}`);
        const created = await this.createMetaobjectDefinition(
          this.targetShopifyClient,
          definition
        );

        if (created) {
          results.created++;
        } else {
          results.failed++;
        }
      }
    }

    return {
      results,
      definitionTypes: sourceDefinitions.map(def => def.type)
    };
  }

  async syncMetaobjectData(definitionTypes) {
    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };

    // Process each definition type
    for (const definitionType of definitionTypes) {
      console.log(`Syncing metaobjects for type: ${definitionType}`);

      // Fetch the definition to check required fields
      const sourceDefinitions = await this.fetchMetaobjectDefinitions(
        this.sourceShopifyClient,
        definitionType
      );

      if (sourceDefinitions.length === 0) {
        console.log(`No definition found for type: ${definitionType}, skipping`);
        continue;
      }

      const definition = sourceDefinitions[0];
      const requiredFields = {};

      // Create a map of required fields
      if (definition.fieldDefinitions) {
        definition.fieldDefinitions.forEach(field => {
          if (field.required) {
            requiredFields[field.key] = {
              name: field.name,
              type: this.getFieldTypeName(field)
            };
          }
        });
      }

      // Fetch metaobjects for this definition
      const sourceMetaobjects = await this.fetchMetaobjects(this.sourceShopifyClient, definitionType);
      console.log(`Found ${sourceMetaobjects.length} metaobject(s) in source shop for type ${definitionType}`);

      const targetMetaobjects = await this.fetchMetaobjects(this.targetShopifyClient, definitionType);
      console.log(`Found ${targetMetaobjects.length} metaobject(s) in target shop for type ${definitionType}`);

      // Create a map of target metaobjects by handle for quick lookup
      const targetMetaobjectMap = {};
      targetMetaobjects.forEach(obj => {
        if (obj.handle) {
          targetMetaobjectMap[obj.handle] = obj;
        }
      });

      // Process each source metaobject
      for (const metaobject of sourceMetaobjects) {
        // Create a map of existing fields by key
        const existingFieldMap = {};
        metaobject.fields.forEach(field => {
          existingFieldMap[field.key] = field;
        });

        // Check for missing required fields and provide default values
        const processedMetaobject = { ...metaobject };
        const processedFields = [...metaobject.fields];

        // Log required fields for debugging
        if (Object.keys(requiredFields).length > 0 && this.debug) {
          console.log(`Metaobject ${metaobject.handle || 'unknown'} has ${Object.keys(requiredFields).length} required fields: ${Object.keys(requiredFields).join(', ')}`);
        }

        // Add missing required fields with default values
        for (const [key, fieldInfo] of Object.entries(requiredFields)) {
          if (!existingFieldMap[key] || existingFieldMap[key].value === null || existingFieldMap[key].value === undefined) {
            console.log(`Adding missing required field '${fieldInfo.name}' (${key}) to metaobject ${metaobject.handle || 'unknown'}`);

            // Provide default value based on field type
            let defaultValue = "";
            if (fieldInfo.type === "boolean") {
              defaultValue = "false";
            } else if (fieldInfo.type === "number_integer") {
              defaultValue = "0";
            } else if (fieldInfo.type === "number_decimal") {
              defaultValue = "0.0";
            } else if (fieldInfo.type === "date") {
              defaultValue = new Date().toISOString().split('T')[0];
            } else if (fieldInfo.type === "datetime") {
              defaultValue = new Date().toISOString();
            }

            processedFields.push({
              key: key,
              value: defaultValue
            });
          }
        }

        // Update the metaobject with processed fields
        processedMetaobject.fields = processedFields;

        if (metaobject.handle && targetMetaobjectMap[metaobject.handle]) {
          // Metaobject exists in target, update it
          console.log(`Updating metaobject: ${metaobject.handle || 'unknown'}`);
          const updated = await this.updateMetaobject(
            this.targetShopifyClient,
            processedMetaobject,
            targetMetaobjectMap[metaobject.handle]
          );

          if (updated) {
            results.updated++;
          } else {
            results.failed++;
          }
        } else {
          // Metaobject doesn't exist in target, create it
          console.log(`Creating metaobject: ${metaobject.handle || 'unknown'}`);
          const created = await this.createMetaobject(
            this.targetShopifyClient,
            processedMetaobject,
            definitionType
          );

          if (created) {
            results.created++;
          } else {
            results.failed++;
          }
        }
      }
    }

    return results;
  }

  async run() {
    let definitionTypes = [];
    let definitionResults = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let dataResults = { created: 0, updated: 0, skipped: 0, failed: 0 };

    // Display environment info
    console.log(`Environment: ${isProd ? 'Production' : 'Development'}`);
    console.log(`Dry Run: ${!this.options.notADrill ? 'Yes (no changes will be made)' : 'No (changes will be made)'}`);
    console.log(`Debug: ${this.options.debug ? 'Enabled' : 'Disabled'}`);
    console.log('');

    // If no specific type was provided, show available types and exit
    if (!this.options.type) {
      console.log("No metaobject type specified. Fetching available types...");
      const sourceDefinitions = await this.fetchMetaobjectDefinitions(this.sourceShopifyClient);

      if (sourceDefinitions.length === 0) {
        console.log("No metaobject definitions found in source shop.");
        return;
      }

      console.log("\nAvailable metaobject types:");
      sourceDefinitions.forEach(def => {
        console.log(`- ${def.type} (${def.name || "No name"})`);
      });

      console.log("\nPlease run the command again with --type <type> to specify which metaobject type to sync.");
      return;
    }

    // Sync definitions if needed
    if (!this.options.dataOnly) {
      const defSync = await this.syncDefinitions();
      definitionTypes = defSync.definitionTypes;
      definitionResults = defSync.results;
    } else if (this.options.type) {
      // If only syncing data for a specific type
      definitionTypes = [this.options.type];
    } else {
      // This should never be reached now, but keeping for safety
      const sourceDefinitions = await this.fetchMetaobjectDefinitions(this.sourceShopifyClient);
      definitionTypes = sourceDefinitions.map(def => def.type);
    }

    // Sync data if needed
    if (!this.options.definitionsOnly) {
      dataResults = await this.syncMetaobjectData(definitionTypes);
    }

    // Display summary
    console.log("\nSync completed:");

    if (!this.options.dataOnly) {
      console.log(`Metaobject Definitions: ${definitionResults.created} created, ${definitionResults.updated} updated, ${definitionResults.failed} failed`);
    }

    if (!this.options.definitionsOnly) {
      console.log(`Metaobject Data: ${dataResults.created} created, ${dataResults.updated} updated, ${dataResults.failed} failed`);
    }
  }
}

async function main() {
  const options = MetaobjectSyncCli.setupCommandLineOptions();

  // Validate we have minimal required configuration
  if (!options.source) {
    console.error("Error: Source shop name is required");
    process.exit(1);
  }

  if (!getShopConfig(options.source)) {
    console.error("Error: Source shop not found in .shops.json");
    process.exit(1);
  }

  // Additional safety check for target name containing 'prod'
  if (options.target && (options.target.toLowerCase().includes('prod') || options.target.toLowerCase().includes('production'))) {
    console.error(`Error: Cannot use "${options.target}" as target - shops with "production" or "prod" in the name are protected for safety.`);
    process.exit(1);
  }

  const syncer = new MetaobjectSyncCli(options);
  await syncer.run();
}

main().catch(error => {
  console.error("Error:", error);
  process.exit(1);
});
