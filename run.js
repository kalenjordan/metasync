#!/usr/bin/env node

const path = require("path");
const fs = require("fs");
const { program } = require("commander");
const Shopify = require('shopify-api-node');
const ShopifyClientWrapper = require('./shopifyClientWrapper'); // Import the wrapper
const consola = require('consola'); // Import consola

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
    consola.error('Error reading .shops.json:', error.message);
    return null;
  }
}

class MetaobjectSyncCli {
  constructor(options = {}) {
    this.options = options;
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
    const sourceClientInstance = new Shopify({
      shopName: sourceShopConfig.domain.replace('.myshopify.com', ''),
      accessToken: sourceShopConfig.accessToken,
      apiVersion: '2024-10',
      autoLimit: this.options.debug ? false : true
    });

    const targetClientInstance = new Shopify({
      shopName: targetShopConfig.domain.replace('.myshopify.com', ''),
      accessToken: targetShopConfig.accessToken,
      apiVersion: '2024-10',
      autoLimit: this.options.debug ? false : true
    });

    // Wrap clients for centralized logging/handling
    this.sourceClient = new ShopifyClientWrapper(sourceClientInstance, this.options.debug);
    this.targetClient = new ShopifyClientWrapper(targetClientInstance, this.options.debug);

    // Add event listeners for call limits if debug is enabled - HANDLED BY WRAPPER NOW
    // if (this.options.debug) {
    //   this.sourceShopifyClient.on('callLimits', limits => console.log('Source shop call limits:', limits));
    //   this.sourceShopifyClient.on('callGraphqlLimits', limits => console.log('Source shop GraphQL limits:', limits));
    //   this.targetShopifyClient.on('callLimits', limits => console.log('Target shop call limits:', limits));
    //   this.targetShopifyClient.on('callGraphqlLimits', limits => console.log('Target shop GraphQL limits:', limits));
    // }
  }

  static setupCommandLineOptions() {
    program
      .description("Sync metaobject or product metafield definitions and data between Shopify stores")
      .option("--source <name>", "Source shop name (must exist in .shops.json)")
      .option("--target <name>", "Target shop name (must exist in .shops.json). Defaults to source shop if not specified")
      .option("--resource-type <type>", "Type of resource to sync (metaobjects or product_metafields)", "metaobjects")
      .option("--key <key>", "Specific definition key/type to sync (e.g., 'my_app.my_def' for metaobjects, 'namespace.key' for metafields - optional for metafields if --namespace is used)")
      .option("--namespace <namespace>", "Namespace to sync (required for product_metafields)")
      .option("--definitions-only", "Sync only the definitions, not the data (Metaobject data sync only)")
      .option("--data-only", "Sync only the data, not the definitions (Metaobject data sync only)")
      .option("--not-a-drill", "Make actual changes (default is dry run)", false)
      .option("--debug", "Enable debug logging", false)
      .option("--limit <number>", "Limit the number of items to process per run", (value) => parseInt(value, 10), 3)
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
      consola.info(`Creating metaobject: ${input.handle || 'unknown'} with ${fields.length} fields`);
      const result = await client.graphql(mutation, { metaobject: input });

      if (result.metaobjectCreate.userErrors.length > 0) {
        const errors = result.metaobjectCreate.userErrors;
        throw new Error(`Failed to create metaobject ${metaobject.handle || 'unknown'}: ${JSON.stringify(errors)}`);
      }

      return result.metaobjectCreate.metaobject;
    } else {
      consola.info(`[DRY RUN] Would create metaobject ${metaobject.handle || 'unknown'} with ${fields.length} fields`);
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
      consola.info(`[DRY RUN] Would update metaobject ${metaobject.handle || 'unknown'}`);
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
      access: { admin: "PUBLIC_READ_WRITE", storefront: "PUBLIC_READ" }
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
        consola.error(`Failed to create metaobject definition ${definition.type}:`, errors);
        return null;
      }

      return result.metaobjectDefinitionCreate.metaobjectDefinition;
    } else {
      consola.info(`[DRY RUN] Would create metaobject definition ${definition.type}`);
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
      access: { admin: "PUBLIC_READ_WRITE", storefront: "PUBLIC_READ" }
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
        consola.error(`Failed to update metaobject definition ${definition.type}:`, errors);
        return null;
      }

      return result.metaobjectDefinitionUpdate.metaobjectDefinition;
    } else {
      consola.info(`[DRY RUN] Would update metaobject definition ${definition.type}`);
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
      this.sourceClient,
      this.options.key
    );

    if (sourceDefinitions.length === 0) {
      if (this.options.key) {
        consola.warn(`No metaobject definitions found in source shop for type: ${this.options.key}`);
      } else {
        consola.warn(`No metaobject definitions found in source shop.`);
      }
      return { results: { created: 0, updated: 0, skipped: 0, failed: 0 }, definitionTypes: [] };
    }

    consola.info(`Found ${sourceDefinitions.length} metaobject definition(s) in source shop${this.options.key ? ` for type: ${this.options.key}` : ''}`);

    const targetDefinitions = await this.fetchMetaobjectDefinitions(
      this.targetClient
    );

    consola.info(`Found ${targetDefinitions.length} metaobject definition(s) in target shop`);

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

    // Process each source definition, respecting the limit
    let processedCount = 0;
    for (const definition of sourceDefinitions) {
      if (processedCount >= this.options.limit) {
          consola.info(`Reached processing limit (${this.options.limit}). Stopping definition sync.`);
          break;
      }

      if (targetDefinitionMap[definition.type]) {
        // Definition exists in target, update it
        consola.info(`Updating metaobject definition: ${definition.type}`);
        const updated = await this.updateMetaobjectDefinition(
          this.targetClient,
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
        consola.info(`Creating metaobject definition: ${definition.type}`);
        const created = await this.createMetaobjectDefinition(
          this.targetClient,
          definition
        );

        if (created) {
          results.created++;
        } else {
          results.failed++;
        }
      }
      processedCount++;
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
      consola.start(`Syncing metaobjects for type: ${definitionType}`);

      // Fetch the definition to check required fields
      const sourceDefinitions = await this.fetchMetaobjectDefinitions(
        this.sourceClient,
        definitionType
      );

      if (sourceDefinitions.length === 0) {
        consola.warn(`No definition found for type: ${definitionType}, skipping`);
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
      const sourceMetaobjects = await this.fetchMetaobjects(this.sourceClient, definitionType);
      consola.info(`Found ${sourceMetaobjects.length} metaobject(s) in source shop for type ${definitionType}`);

      const targetMetaobjects = await this.fetchMetaobjects(this.targetClient, definitionType);
      consola.info(`Found ${targetMetaobjects.length} metaobject(s) in target shop for type ${definitionType}`);

      // Create a map of target metaobjects by handle for quick lookup
      const targetMetaobjectMap = {};
      targetMetaobjects.forEach(obj => {
        if (obj.handle) {
          targetMetaobjectMap[obj.handle] = obj;
        }
      });

      // Process each source metaobject, respecting the limit for this type
      let processedCount = 0;
      for (const metaobject of sourceMetaobjects) {
        if (processedCount >= this.options.limit) {
            consola.info(`Reached processing limit (${this.options.limit}) for type ${definitionType}. Moving to next type.`);
            break;
        }

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
          consola.debug(`Metaobject ${metaobject.handle || 'unknown'} has ${Object.keys(requiredFields).length} required fields: ${Object.keys(requiredFields).join(', ')}`);
        }

        // Add missing required fields with default values
        for (const [key, fieldInfo] of Object.entries(requiredFields)) {
          if (!existingFieldMap[key] || existingFieldMap[key].value === null || existingFieldMap[key].value === undefined) {
            consola.warn(`Adding missing required field '${fieldInfo.name}' (${key}) to metaobject ${metaobject.handle || 'unknown'}`);

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
          consola.info(`Updating metaobject: ${metaobject.handle || 'unknown'}`);
          const updated = await this.updateMetaobject(
            this.targetClient,
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
          consola.info(`Creating metaobject: ${metaobject.handle || 'unknown'}`);
          const created = await this.createMetaobject(
            this.targetClient,
            processedMetaobject,
            definitionType
          );

          if (created) {
            results.created++;
          } else {
            results.failed++;
          }
        }
        processedCount++;
      }
      consola.success(`Finished syncing metaobjects for type: ${definitionType}`);
    }

    return results;
  }

  async run() {
    let definitionKeys = [];
    let definitionResults = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let dataResults = { created: 0, updated: 0, skipped: 0, failed: 0 };

    // Validate resource type
    const validResourceTypes = ['metaobjects', 'product_metafields'];
    if (!validResourceTypes.includes(this.options.resourceType)) {
      consola.error(`Error: Invalid resource type "${this.options.resourceType}". Valid types are: ${validResourceTypes.join(', ')}`);
      process.exit(1);
    }

    // Validate options based on resource type
    if (this.options.resourceType === 'product_metafields') {
        // Namespace is required for product metafields
        if (!this.options.namespace) {
            consola.error("Error: --namespace is required when --resource-type is product_metafields.");
            process.exit(1);
        }

        // If key is provided, ensure it matches the namespace
        if (this.options.key && !this.options.key.startsWith(this.options.namespace + '.')) {
             consola.error(`Error: Provided --key "${this.options.key}" does not start with the provided --namespace "${this.options.namespace}".`);
             process.exit(1);
        }

        // Currently, only definition sync is supported for product metafields
        if (this.options.dataOnly) {
            consola.error("Error: --data-only is not supported for product_metafields.");
            process.exit(1);
        }
        if (!this.options.definitionsOnly && !this.options.dataOnly) {
             // If neither --definitions-only nor --data-only is set, the default is both.
             // We need to explicitly set definitionsOnly for metafields.
             consola.warn("Warning: Only definition sync is supported for product_metafields. Proceeding with definitions only.");
             this.options.definitionsOnly = true;
        }
    }

    // Display info
    consola.info(`Syncing Resource Type: ${this.options.resourceType}`);
    consola.info(`Dry Run: ${!this.options.notADrill ? 'Yes (no changes will be made)' : 'No (changes will be made)'}`);
    consola.info(`Debug: ${this.options.debug ? 'Enabled' : 'Disabled'}`);
    consola.info(`Limit: ${this.options.limit}`);

    // Determine if we need to list definitions and exit
    let shouldListAndExit = false;
    let listPrompt = "";

    if (this.options.resourceType === 'metaobjects' && !this.options.key) {
        shouldListAndExit = true;
        listPrompt = "\nPlease run the command again with --key <type> to specify which metaobject type to sync.";
        consola.info(`No specific metaobject type specified (--key). Fetching available types...`);
    } else if (this.options.resourceType === 'product_metafields' && !this.options.namespace) {
        // This case is now handled by the validation above, but we keep the structure
        // If validation were removed, this would list all product metafields.
        shouldListAndExit = true; // Although validation exits first
        listPrompt = "\nPlease run the command again with --namespace <namespace> to specify which product metafield namespace to sync.";
        consola.info(`No namespace specified (--namespace). Fetching all available product metafield definitions...`);
    }

    // If no specific key/namespace was provided (as required), show available definitions and exit
    if (shouldListAndExit) {
        // console.log(`No specific key specified for ${this.options.resourceType}. Fetching available definitions...`);
        let definitions = [];
        if (this.options.resourceType === 'metaobjects') {
            definitions = await this.fetchMetaobjectDefinitions(this.sourceClient);
        } else if (this.options.resourceType === 'product_metafields') {
            // Fetch all product metafield definitions from the source shop
            definitions = await this.fetchProductMetafieldDefinitions(this.sourceClient);
        }

        if (definitions.length === 0) {
            consola.warn(`No ${this.options.resourceType} definitions found in source shop.`);
            return;
        }

        consola.info(`\nAvailable ${this.options.resourceType} definition keys/types:`);
        definitions.forEach(def => {
            // Metaobjects use 'type', metafields use 'key' and 'namespace'
            let identifier = "unknown";
            let name = def.name || "No name";
            if (this.options.resourceType === 'metaobjects') {
                identifier = def.type;
            } else if (this.options.resourceType === 'product_metafields' && def.namespace && def.key) {
                identifier = `${def.namespace}.${def.key}`;
            }
            consola.log(`- ${identifier} (${name})`);
        });

        consola.info(listPrompt);
        return;
    }

    // Sync definitions if needed
    if (!this.options.dataOnly) {
       if (this.options.resourceType === 'metaobjects') {
           const defSync = await this.syncDefinitions(); // Existing metaobject sync
           definitionKeys = defSync.definitionTypes; // Actually types for metaobjects
           definitionResults = defSync.results;
       } else if (this.options.resourceType === 'product_metafields') {
           consola.start("Syncing product metafield definitions...");
           const defSync = await this.syncMetafieldDefinitions();
           definitionKeys = defSync.definitionKeys;
           definitionResults = defSync.results;
           consola.success("Finished syncing product metafield definitions.");
       }
    } else if (this.options.key && this.options.resourceType === 'metaobjects') {
      // If only syncing data for a specific metaobject type
      definitionKeys = [this.options.key]; // Use key here which maps to type for metaobjects
    } else if (this.options.dataOnly && this.options.resourceType === 'product_metafields') {
        // This case is already handled by the validation above, but adding a safeguard.
        consola.error("Error: Data sync (--data-only) is not supported for product_metafields.");
        return;
    }

    // Sync data if needed (only for metaobjects currently)
    if (!this.options.definitionsOnly && this.options.resourceType === 'metaobjects') {
      dataResults = await this.syncMetaobjectData(definitionKeys); // Pass metaobject types
    }

    // Display summary
    consola.success("Sync completed:");

    if (!this.options.dataOnly) {
      consola.info(`${this.options.resourceType === 'metaobjects' ? 'Metaobject' : 'Product Metafield'} Definitions: ${definitionResults.created} created, ${definitionResults.updated} updated, ${definitionResults.failed} failed`);
    }

    if (!this.options.definitionsOnly && this.options.resourceType === 'metaobjects') {
      consola.info(`Metaobject Data: ${dataResults.created} created, ${dataResults.updated} updated, ${dataResults.failed} failed`);
    }
  }

  // --- Metafield Definition Sync Methods ---

  async fetchProductMetafieldDefinitions(client, namespace = null, key = null) {
    let definitionKey = null;

    if (key) {
      // Key is expected in "namespace.key" format
      const parts = key.split('.');
      if (parts.length >= 2) {
        // We already filter by namespace separately, so just extract the key part
        definitionKey = parts.slice(1).join('.'); // Handle keys with dots
      } else {
        consola.warn(`Invalid key format for metafield definition: ${key}. Expected 'namespace.key'. Ignoring key filter.`);
      }
    }

    const query = `#graphql
      query FetchProductMetafieldDefinitions($ownerType: MetafieldOwnerType!, $namespace: String, $key: String) {
        metafieldDefinitions(first: 100, ownerType: $ownerType, namespace: $namespace, key: $key) {
          nodes {
            id
            namespace
            key
            name
            description
            type {
              name # Use name instead of deprecated valueType
            }
            validations {
              name
              value
            }
            access {
              admin
              storefront
            }
            # Add other fields as needed, e.g., capabilities, pinnedPosition
          }
        }
      }
    `;

    const variables = { ownerType: 'PRODUCT' };
    if (namespace) variables.namespace = namespace;
    if (definitionKey !== null) variables.key = definitionKey;

    try {
        const response = await client.graphql(query, variables);
        return response.metafieldDefinitions.nodes;
    } catch (error) {
        consola.error(`Error fetching product metafield definitions: ${error.message}`);
        return []; // Return empty array on error
    }
  }

  async createProductMetafieldDefinition(client, definition) {
    const input = {
      ownerType: 'PRODUCT',
      namespace: definition.namespace,
      key: definition.key,
      name: definition.name,
      description: definition.description || "",
      type: definition.type.name, // Ensure we use the type name string
      validations: definition.validations || [],
      // Conditionally replace MERCHANT_READ_WRITE for update, otherwise use source or default
      access: {
        admin: (definition.access?.admin === 'MERCHANT_READ_WRITE')
                 ? 'PUBLIC_READ_WRITE'
                 : (definition.access?.admin || 'PUBLIC_READ_WRITE'), // Default to PUBLIC_READ_WRITE if source is null/other
        storefront: definition.access?.storefront || 'PUBLIC_READ' // Default to PUBLIC_READ
      },
      // Add other fields like pin, capabilities if needed from source definition
    };

    const mutation = `#graphql
      mutation createMetafieldDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition {
            id
            namespace
            key
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
      try {
          const result = await client.graphql(mutation, { definition: input });

          if (result.metafieldDefinitionCreate.userErrors.length > 0) {
            const errors = result.metafieldDefinitionCreate.userErrors;
            consola.error(`Failed to create product metafield definition ${input.namespace}.${input.key}:`, errors);
            return null;
          }

          return result.metafieldDefinitionCreate.createdDefinition;
      } catch (error) {
          consola.error(`Error creating product metafield definition ${input.namespace}.${input.key}: ${error.message}`);
          return null;
      }
    } else {
      consola.info(`[DRY RUN] Would create product metafield definition ${input.namespace}.${input.key}`);
      return { id: "dry-run-id", namespace: input.namespace, key: input.key };
    }
  }

   async updateProductMetafieldDefinition(client, definition, existingDefinition) {
        // Note: MetafieldDefinitionUpdateInput requires the ID.
        // It allows updating name, description, validations, access, capabilities, pin status.
        // Namespace, key, type, and ownerType are generally not updatable.

        const input = {
            // Fields that can be updated:
            name: definition.name,
            description: definition.description || "",
            validations: definition.validations || [],
            // Conditionally replace MERCHANT_READ_WRITE for update, otherwise use source or default
            access: {
                admin: (definition.access?.admin === 'MERCHANT_READ_WRITE')
                         ? 'PUBLIC_READ_WRITE'
                         : (definition.access?.admin || 'PUBLIC_READ_WRITE'), // Default to PUBLIC_READ_WRITE if source is null/other
                storefront: definition.access?.storefront || 'PUBLIC_READ' // Default to PUBLIC_READ
            },
            // Add other updatable fields like pin, capabilities if needed
        };

        const mutation = `#graphql
          mutation updateMetafieldDefinition($id: ID!, $definition: MetafieldDefinitionUpdateInput!) {
            metafieldDefinitionUpdate(id: $id, definition: $definition) {
              updatedDefinition {
                id
                namespace
                key
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
            try {
                const result = await client.graphql(mutation, {
                    id: existingDefinition.id,
                    definition: input
                });

                if (result.metafieldDefinitionUpdate.userErrors.length > 0) {
                    const errors = result.metafieldDefinitionUpdate.userErrors;
                    consola.error(`Failed to update product metafield definition ${definition.namespace}.${definition.key}:`, errors);
                    return null;
                }

                return result.metafieldDefinitionUpdate.updatedDefinition;
            } catch (error) {
                 consola.error(`Error updating product metafield definition ${definition.namespace}.${definition.key}: ${error.message}`);
                 return null;
            }
        } else {
            consola.info(`[DRY RUN] Would update product metafield definition ${definition.namespace}.${definition.key}`);
            return { id: existingDefinition.id, namespace: definition.namespace, key: definition.key };
        }
    }

  async syncMetafieldDefinitions() {
    const sourceDefinitions = await this.fetchProductMetafieldDefinitions(
      this.sourceClient,
      this.options.namespace,
      this.options.key
    );

    if (sourceDefinitions.length === 0) {
      if (this.options.key) {
        consola.warn(`No product metafield definitions found in source shop for key: ${this.options.key}`);
      } else {
        consola.warn(`No product metafield definitions found in source shop for namespace: ${this.options.namespace}`);
      }
      return { results: { created: 0, updated: 0, skipped: 0, failed: 0 }, definitionKeys: [] };
    }

    consola.info(`Found ${sourceDefinitions.length} product metafield definition(s) in source shop${this.options.key ? ` for key: ${this.options.key}` : this.options.namespace ? ` for namespace: ${this.options.namespace}`: ''}`);

    // Fetch all target definitions for comparison (cannot filter update/create by namespace+key efficiently in one go)
    const targetDefinitions = await this.fetchProductMetafieldDefinitions(
      this.targetClient
    );

    consola.info(`Found ${targetDefinitions.length} product metafield definition(s) in target shop`);

    // Create a map of target definitions by "namespace.key" for quick lookup
    const targetDefinitionMap = {};
    targetDefinitions.forEach(def => {
      targetDefinitionMap[`${def.namespace}.${def.key}`] = def;
    });

    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };

    const definitionKeys = [];

    // Process each source definition, respecting the limit
    let processedCount = 0;
    for (const definition of sourceDefinitions) {
       if (processedCount >= this.options.limit) {
          consola.info(`Reached processing limit (${this.options.limit}). Stopping metafield definition sync.`);
          break;
      }

      const definitionFullKey = `${definition.namespace}.${definition.key}`;
      definitionKeys.push(definitionFullKey);

      if (targetDefinitionMap[definitionFullKey]) {
        // Definition exists in target, update it
        consola.info(`Updating product metafield definition: ${definitionFullKey}`);
        const updated = await this.updateProductMetafieldDefinition(
          this.targetClient,
          definition,
          targetDefinitionMap[definitionFullKey]
        );

        if (updated) {
          results.updated++;
        } else {
          results.failed++;
        }
      } else {
        // Definition doesn't exist in target, create it
        consola.info(`Creating product metafield definition: ${definitionFullKey}`);
        const created = await this.createProductMetafieldDefinition(
          this.targetClient,
          definition
        );

        if (created) {
          results.created++;
        } else {
          results.failed++;
        }
      }
      processedCount++;
    }

    return {
      results,
      definitionKeys
    };
  }

  // --- End Metafield Definition Sync Methods ---
}

async function main() {
  const options = MetaobjectSyncCli.setupCommandLineOptions();

  // Set consola log level based on debug flag
  if (options.debug) {
    consola.level = 3; // Revert to assignment
  }

  // Validate we have minimal required configuration
  if (!options.source) {
    consola.error("Error: Source shop name is required");
    process.exit(1);
  }

  if (!getShopConfig(options.source)) {
    consola.error("Error: Source shop not found in .shops.json");
    process.exit(1);
  }

  // Additional safety check for target name containing 'prod'
  if (options.target && (options.target.toLowerCase().includes('prod') || options.target.toLowerCase().includes('production'))) {
    consola.error(`Error: Cannot use "${options.target}" as target - shops with "production" or "prod" in the name are protected for safety.`);
    process.exit(1);
  }

  const syncer = new MetaobjectSyncCli(options);
  await syncer.run();
}

main().catch(error => {
  consola.fatal("Unhandled Error:", error);
  process.exit(1);
});
