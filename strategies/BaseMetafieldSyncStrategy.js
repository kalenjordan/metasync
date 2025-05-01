const consola = require("consola");

class BaseMetafieldSyncStrategy {
  // ownerType will be 'PRODUCT', 'COMPANY', etc.
  constructor(sourceClient, targetClient, options, ownerType) {
    if (!ownerType) {
      throw new Error("ownerType must be provided to BaseMetafieldSyncStrategy");
    }
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.ownerType = ownerType;
    this.resourceName = ownerType.toLowerCase().replace('_', ' ') + ' metafield'; // e.g., 'product metafield', 'company metafield'
    this.debug = options.debug;
  }

  // --- Metafield Definition Methods ---

  async fetchMetafieldDefinitions(client, namespace = null, key = null) {
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
          query FetchMetafieldDefinitions($ownerType: MetafieldOwnerType!, $namespace: String, $key: String) {
            metafieldDefinitions(first: 100, ownerType: $ownerType, namespace: $namespace, key: $key) {
              nodes { id namespace key name description type { name } validations { name value } access { admin storefront } pinnedPosition }
            }
          }
        `;
    const variables = { ownerType: this.ownerType };
    if (namespace) variables.namespace = namespace;
    if (definitionKey !== null) variables.key = definitionKey;
    const operationName = `Fetch${this.ownerType}MetafieldDefinitions`;
    try {
      const response = await client.graphql(query, variables, operationName);
      return response.metafieldDefinitions.nodes;
    } catch (error) {
      consola.error(`Error fetching ${this.resourceName} definitions: ${error.message}`);
      return [];
    }
  }

  async createMetafieldDefinition(client, definition) {
    const input = {
      ownerType: this.ownerType,
      namespace: definition.namespace,
      key: definition.key,
      name: definition.name,
      description: definition.description || "",
      type: definition.type.name,
      validations: definition.validations || [],
      access: {
        admin: definition.access?.admin === "MERCHANT_READ_WRITE" ? "PUBLIC_READ_WRITE" : definition.access?.admin || "PUBLIC_READ_WRITE",
        storefront: definition.access?.storefront || "PUBLIC_READ",
      },
      pin: definition.pinnedPosition != null && definition.pinnedPosition >= 0
    };
    const mutation = `#graphql
          mutation createMetafieldDefinition($definition: MetafieldDefinitionInput!) {
            metafieldDefinitionCreate(definition: $definition) {
              createdDefinition { id namespace key }
              userErrors { field message code }
            }
          }
        `;
    const operationName = `Create${this.ownerType}MetafieldDefinition`;
    if (this.options.notADrill) {
      try {
        const result = await client.graphql(mutation, { definition: input }, operationName);
        if (result.metafieldDefinitionCreate.userErrors.length > 0) {
          consola.error(
            `Failed to create ${this.resourceName} definition ${input.namespace}.${input.key}:`,
            result.metafieldDefinitionCreate.userErrors
          );
          return null;
        }
        return result.metafieldDefinitionCreate.createdDefinition;
      } catch (error) {
        consola.error(`Error creating ${this.resourceName} definition ${input.namespace}.${input.key}: ${error.message}`);
        return null;
      }
    } else {
      consola.info(`[DRY RUN] Would create ${this.resourceName} definition ${input.namespace}.${input.key}`);
      return { id: "dry-run-id", namespace: input.namespace, key: input.key };
    }
  }

  async updateMetafieldDefinition(client, definition, existingDefinition) {
    const input = {
      name: definition.name,
      description: definition.description || "",
      validations: definition.validations || [],
      access: {
        admin: definition.access?.admin === "MERCHANT_READ_WRITE" ? "PUBLIC_READ_WRITE" : definition.access?.admin || "PUBLIC_READ_WRITE",
        storefront: definition.access?.storefront || "PUBLIC_READ",
      },
      // Required identification fields for update
      ownerType: this.ownerType,
      namespace: definition.namespace, // Use source namespace for identification
      key: definition.key,
      pin: definition.pinnedPosition != null && definition.pinnedPosition >= 0 // Pin/unpin based on source
    };
    const mutation = `#graphql
          mutation updateMetafieldDefinition($definition: MetafieldDefinitionUpdateInput!) {
            metafieldDefinitionUpdate(definition: $definition) {
              updatedDefinition { id namespace key }
              userErrors { field message code }
            }
          }
        `;
    const operationName = `Update${this.ownerType}MetafieldDefinition`;
    if (this.options.notADrill) {
      try {
        const result = await client.graphql(mutation, { definition: input }, operationName);
        if (result.metafieldDefinitionUpdate.userErrors.length > 0) {
          consola.error(
            `Failed to update ${this.resourceName} definition ${definition.namespace}.${definition.key}:`,
            result.metafieldDefinitionUpdate.userErrors
          );
          return null;
        }
        return result.metafieldDefinitionUpdate.updatedDefinition;
      } catch (error) {
        consola.error(`Error updating ${this.resourceName} definition ${definition.namespace}.${definition.key}: ${error.message}`);
        return null;
      }
    } else {
      consola.info(`[DRY RUN] Would update ${this.resourceName} definition ${definition.namespace}.${definition.key}`);
      return { id: existingDefinition.id, namespace: definition.namespace, key: definition.key };
    }
  }

  async getMetaobjectDefinitionTypeById(client, definitionId) {
    const query = `#graphql
      query GetMetaobjectDefinitionType($id: ID!) {
        metaobjectDefinition(id: $id) {
          type
        }
      }
    `;
    try {
      const response = await client.graphql(query, { id: definitionId }, "GetMetaobjectDefinitionType");
      if (response.metaobjectDefinition) {
        return response.metaobjectDefinition.type;
      } else {
        consola.warn(`Metaobject definition with ID ${definitionId} not found.`);
        return null;
      }
    } catch (error) {
      consola.error(`Error fetching metaobject definition type for ID ${definitionId}: ${error.message}`);
      return null;
    }
  }

  async getMetaobjectDefinitionIdByType(client, definitionType) {
    const query = `#graphql
      query GetMetaobjectDefinitionId($type: String!) {
        metaobjectDefinitionByType(type: $type) {
          id
        }
      }
    `;
    try {
      const response = await client.graphql(query, { type: definitionType }, "GetMetaobjectDefinitionId");
      if (response.metaobjectDefinitionByType) {
        return response.metaobjectDefinitionByType.id;
      } else {
        consola.warn(`Metaobject definition with type ${definitionType} not found in target store.`);
        return null;
      }
    } catch (error) {
      consola.error(`Error fetching metaobject definition ID for type ${definitionType}: ${error.message}`);
      return null;
    }
  }

  // --- Sync Orchestration Methods ---

  async syncDefinitionsOnly() {
    const sourceDefinitions = await this.fetchMetafieldDefinitions(this.sourceClient, this.options.namespace, this.options.key);
    if (sourceDefinitions.length === 0) {
      consola.warn(
        this.options.key
          ? `No ${this.resourceName} definitions found in source for key: ${this.options.key}`
          : `No ${this.resourceName} definitions found in source for namespace: ${this.options.namespace}`
      );
      return { results: { created: 0, updated: 0, skipped: 0, failed: 0 }, definitionKeys: [] };
    }
    consola.info(
      `Found ${sourceDefinitions.length} definition(s) in source ${
        this.options.key ? `for key ${this.options.key}` : this.options.namespace ? `for namespace ${this.options.namespace}` : ""
      }`
    );

    const targetDefinitions = await this.fetchMetafieldDefinitions(this.targetClient, this.options.namespace);
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
        consola.info(`Reached processing limit (${this.options.limit}). Stopping ${this.resourceName} definition sync.`);
        break;
      }
      const definitionFullKey = `${definition.namespace}.${definition.key}`;
      definitionKeys.push(definitionFullKey);

      // --- Resolve Metaobject References in Validations --- START ---
      let definitionToSync = { ...definition }; // Work on a copy
      let resolutionError = false;
      if ((definition.type.name === 'metaobject_reference' || definition.type.name === 'list.metaobject_reference') && definition.validations?.length > 0) {
        consola.debug(`Resolving metaobject references for ${definitionFullKey}`);
        const resolvedValidations = [];
        for (const validation of definition.validations) {
          // Assuming the validation 'value' holds the GID for relevant rules
          // We might need a more robust check based on validation 'name'
          if (validation.value?.startsWith('gid://shopify/MetaobjectDefinition/')) {
            const sourceMoDefId = validation.value;
            const sourceMoDefType = await this.getMetaobjectDefinitionTypeById(this.sourceClient, sourceMoDefId);

            if (!sourceMoDefType) {
              consola.error(`Failed to find type for source Metaobject Definition ID ${sourceMoDefId} referenced by ${definitionFullKey}. Skipping definition.`);
              resolutionError = true;
              break; // Stop processing validations for this definition
            }

            const targetMoDefId = await this.getMetaobjectDefinitionIdByType(this.targetClient, sourceMoDefType);

            if (!targetMoDefId) {
              consola.error(`Failed to find target Metaobject Definition for type ${sourceMoDefType} (referenced by ${definitionFullKey}). Ensure it exists in the target store. Skipping definition.`);
              resolutionError = true;
              break; // Stop processing validations for this definition
            }

            consola.debug(`  Mapping validation ref: ${sourceMoDefId} (type: ${sourceMoDefType}) -> ${targetMoDefId}`);
            resolvedValidations.push({ ...validation, value: targetMoDefId });
          } else {
            resolvedValidations.push(validation); // Keep non-reference validations as is
          }
        }

        if (!resolutionError) {
          definitionToSync.validations = resolvedValidations;
        }
      }
      // --- Resolve Metaobject References in Validations --- END ---

      if (resolutionError) {
        results.failed++; // Mark as failed if resolution failed
        processedCount++;
        continue; // Skip to the next definition
      }

      const targetDefinition = targetDefinitionMap[definitionFullKey];

      if (targetDefinition) {
        consola.info(`Updating ${this.resourceName} definition: ${definitionFullKey}`);
        // Pass the potentially modified definitionToSync
        const updated = await this.updateMetafieldDefinition(this.targetClient, definitionToSync, targetDefinition);
        updated ? results.updated++ : results.failed++;
      } else {
        consola.info(`Creating ${this.resourceName} definition: ${definitionFullKey}`);
        // Pass the potentially modified definitionToSync
        const created = await this.createMetafieldDefinition(this.targetClient, definitionToSync);
        created ? results.created++ : results.failed++;
      }
      processedCount++;
    }
    return { results, definitionKeys };
  }

  async listAvailableDefinitions() {
    consola.info(`Fetching all available ${this.resourceName} definitions... (Triggered because --namespace was not specified)`);
    const definitions = await this.fetchMetafieldDefinitions(this.sourceClient);
    if (definitions.length === 0) {
      consola.warn(`No ${this.resourceName} definitions found in source shop.`);
      return;
    }
    consola.info(`\nAvailable ${this.resourceName} namespaces/keys:`);
    definitions.forEach((def) => {
      const identifier = `${def.namespace}.${def.key}`;
      consola.log(`- ${identifier} (${def.name || "No name"})`);
    });
    consola.info(`\nPlease run the command again with --namespace <namespace> to specify which ${this.resourceName} namespace to sync.`);
  }

  async sync() {
    // Handle listing if namespace is missing (relevant for metafield types)
    if (!this.options.namespace) {
      await this.listAvailableDefinitions();
      return { definitionResults: null, dataResults: null };
    }

    let definitionResults = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let dataResults = null; // Data sync not supported for metafields

    // Only definition sync is supported for metafields
    if (!this.options.dataOnly) {
      consola.start(`Syncing ${this.resourceName} definitions...`);
      const defSync = await this.syncDefinitionsOnly();
      definitionResults = defSync.results;
      consola.success(`Finished syncing ${this.resourceName} definitions.`);
    } else {
      // This case should ideally be caught by run.js validation
      consola.error(`Data sync (--data-only) is not supported for ${this.resourceName}s.`);
      return { definitionResults: null, dataResults: null };
    }

    // No data sync part for metafields
    return { definitionResults, dataResults };
  }
}

module.exports = BaseMetafieldSyncStrategy;
