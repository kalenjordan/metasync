const consola = require("consola");

class ProductMetafieldSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.debug = options.debug;
  }

  // --- Metafield Definition Methods ---

  async fetchProductMetafieldDefinitions(client, namespace = null, key = null) {
    let definitionKey = null;
    if (key) {
      const parts = key.split(".");
      if (parts.length >= 2) {
        definitionKey = parts.slice(1).join(".");
      } else {
        consola.warn(`Invalid key format for metafield definition: ${key}. Expected 'namespace.key'. Ignoring key filter.`);
      }
    }
    const query = `#graphql
          query FetchProductMetafieldDefinitions($ownerType: MetafieldOwnerType!, $namespace: String, $key: String) {
            metafieldDefinitions(first: 100, ownerType: $ownerType, namespace: $namespace, key: $key) {
              nodes { id namespace key name description type { name } validations { name value } access { admin storefront } }
            }
          }
        `;
    // Simplified fields in query log
    const variables = { ownerType: "PRODUCT" };
    if (namespace) variables.namespace = namespace;
    if (definitionKey !== null) variables.key = definitionKey;
    try {
      const response = await client.graphql(query, variables, "FetchProductMetafieldDefinitions");
      return response.metafieldDefinitions.nodes;
    } catch (error) {
      consola.error(`Error fetching product metafield definitions: ${error.message}`);
      return [];
    }
  }

  async createProductMetafieldDefinition(client, definition) {
    const input = {
      ownerType: "PRODUCT",
      namespace: definition.namespace,
      key: definition.key,
      name: definition.name,
      description: definition.description || "",
      type: definition.type.name,
      validations: definition.validations || [],
      // Use conditional replacement logic
      access: {
        admin: definition.access?.admin === "MERCHANT_READ_WRITE" ? "PUBLIC_READ_WRITE" : definition.access?.admin || "PUBLIC_READ_WRITE",
        storefront: definition.access?.storefront || "PUBLIC_READ",
      },
    };
    const mutation = `#graphql
          mutation createMetafieldDefinition($definition: MetafieldDefinitionInput!) {
            metafieldDefinitionCreate(definition: $definition) {
              createdDefinition { id namespace key }
              userErrors { field message code }
            }
          }
        `;
    if (this.options.notADrill) {
      try {
        const result = await client.graphql(mutation, { definition: input }, "CreateProductMetafieldDefinition");
        if (result.metafieldDefinitionCreate.userErrors.length > 0) {
          consola.error(
            `Failed to create product metafield definition ${input.namespace}.${input.key}:`,
            result.metafieldDefinitionCreate.userErrors
          );
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
    const input = {
      name: definition.name,
      description: definition.description || "",
      validations: definition.validations || [],
      access: {
        admin: definition.access?.admin === "MERCHANT_READ_WRITE" ? "PUBLIC_READ_WRITE" : definition.access?.admin || "PUBLIC_READ_WRITE",
        storefront: definition.access?.storefront || "PUBLIC_READ",
      },
      // Required identification fields for update
      ownerType: "PRODUCT",
      namespace: definition.namespace, // Use source namespace for identification
      key: definition.key,
    };
    const mutation = `#graphql
          mutation updateMetafieldDefinition($definition: MetafieldDefinitionUpdateInput!) {
            metafieldDefinitionUpdate(definition: $definition) {
              updatedDefinition { id namespace key }
              userErrors { field message code }
            }
          }
        `;
    if (this.options.notADrill) {
      try {
        const result = await client.graphql(mutation, { definition: input }, "UpdateProductMetafieldDefinition");
        if (result.metafieldDefinitionUpdate.userErrors.length > 0) {
          consola.error(
            `Failed to update product metafield definition ${definition.namespace}.${definition.key}:`,
            result.metafieldDefinitionUpdate.userErrors
          );
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

  // --- Sync Orchestration Methods ---

  async syncDefinitionsOnly() {
    const sourceDefinitions = await this.fetchProductMetafieldDefinitions(this.sourceClient, this.options.namespace, this.options.key);
    if (sourceDefinitions.length === 0) {
      consola.warn(
        this.options.key
          ? `No product metafield definitions found in source for key: ${this.options.key}`
          : `No product metafield definitions found in source for namespace: ${this.options.namespace}`
      );
      return { results: { created: 0, updated: 0, skipped: 0, failed: 0 }, definitionKeys: [] };
    }
    consola.info(
      `Found ${sourceDefinitions.length} definition(s) in source ${
        this.options.key ? `for key ${this.options.key}` : this.options.namespace ? `for namespace ${this.options.namespace}` : ""
      }`
    );

    const targetDefinitions = await this.fetchProductMetafieldDefinitions(this.targetClient, this.options.namespace);
    consola.info(`Found ${targetDefinitions.length} definition(s) in target (for namespace: ${this.options.namespace || "all"})`);
    const targetDefinitionMap = targetDefinitions.reduce((map, def) => {
      map[`${def.namespace}.${def.key}`] = def;
      return map;
    }, {});

    const results = { created: 0, updated: 0, skipped: 0, failed: 0 };
    const definitionKeys = [];
    let processedCount = 0;

    for (const definition of sourceDefinitions) {
      if (processedCount >= this.options.limit) {
        consola.info(`Reached processing limit (${this.options.limit}). Stopping metafield definition sync.`);
        break;
      }
      const definitionFullKey = `${definition.namespace}.${definition.key}`;
      definitionKeys.push(definitionFullKey);

      // Use simple key lookup - assuming namespaces match or are handled correctly by API/source data
      const targetDefinition = targetDefinitionMap[definitionFullKey];

      if (targetDefinition) {
        consola.info(`Updating product metafield definition: ${definitionFullKey}`);
        const updated = await this.updateProductMetafieldDefinition(this.targetClient, definition, targetDefinition);
        updated ? results.updated++ : results.failed++;
      } else {
        consola.info(`Creating product metafield definition: ${definitionFullKey}`);
        const created = await this.createProductMetafieldDefinition(this.targetClient, definition);
        created ? results.created++ : results.failed++;
      }
      processedCount++;
    }
    return { results, definitionKeys };
  }

  async listAvailableDefinitions() {
    consola.info(`No namespace specified (--namespace). Fetching all available product metafield definitions...`);
    const definitions = await this.fetchProductMetafieldDefinitions(this.sourceClient);
    if (definitions.length === 0) {
      consola.warn(`No product metafield definitions found in source shop.`);
      return;
    }
    consola.info(`\nAvailable product metafield namespaces/keys:`);
    definitions.forEach((def) => {
      const identifier = `${def.namespace}.${def.key}`;
      consola.log(`- ${identifier} (${def.name || "No name"})`);
    });
    consola.info("\nPlease run the command again with --namespace <namespace> to specify which product metafield namespace to sync.");
  }

  async sync() {
    // Handle listing if namespace is missing
    if (!this.options.namespace) {
      await this.listAvailableDefinitions();
      return { definitionResults: null, dataResults: null };
    }

    let definitionResults = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let dataResults = null; // Data sync not supported

    // Only definition sync is supported
    if (!this.options.dataOnly) {
      consola.start("Syncing product metafield definitions...");
      const defSync = await this.syncDefinitionsOnly();
      definitionResults = defSync.results;
      consola.success("Finished syncing product metafield definitions.");
    } else {
      consola.error("Data sync (--data-only) is not supported for product_metafields.");
      return { definitionResults: null, dataResults: null };
    }

    // No data sync part for product metafields
    return { definitionResults, dataResults };
  }
}

module.exports = ProductMetafieldSyncStrategy;
