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
    const LoggingUtils = require('../utils/LoggingUtils');

    let definitionKey = null;
    if (key) {
      const parts = key.split(".");
      if (parts.length >= 2) {
        // Key includes namespace (e.g., "namespace.key")
        // Extract just the key part after the namespace
        definitionKey = parts.slice(1).join(".");

        // If namespace wasn't provided but is in the key, extract it
        if (!namespace) {
          namespace = parts[0];
          LoggingUtils.info(`Using namespace "${namespace}" from the provided key`);
        }
      } else {
        // Key doesn't include namespace, use as-is
        definitionKey = key;
        LoggingUtils.info(`Using key "${definitionKey}" with namespace "${namespace}"`);
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

    if (this.options.debug) {
      LoggingUtils.debug(`Fetching metafield definitions with: namespace=${namespace}, key=${definitionKey}`);
    }

    const operationName = `Fetch${this.ownerType}MetafieldDefinitions`;
    try {
      const response = await client.graphql(query, variables, operationName);
      return response.metafieldDefinitions.nodes;
    } catch (error) {
      LoggingUtils.error(`Error fetching ${this.resourceName} definitions: ${error.message}`);
      return [];
    }
  }

  async createMetafieldDefinition(client, definition) {
    const LoggingUtils = require('../utils/LoggingUtils');

    const input = {
      ownerType: this.ownerType,
      namespace: definition.namespace,
      key: definition.key,
      name: definition.name,
      description: definition.description || "",
      type: definition.type.name,
      validations: definition.validations || [],
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
          // Check if the error is due to the pinned limit being reached
          const pinnedLimitError = result.metafieldDefinitionCreate.userErrors.find(
            error => error.code === 'PINNED_LIMIT_REACHED'
          );

          if (pinnedLimitError && input.pin) {
            // If pinned limit reached and we tried to create a pinned definition,
            // retry with pin: false
            LoggingUtils.warn(
              `Pinned limit reached for ${this.resourceName} definition ${input.namespace}.${input.key}. Retrying as unpinned.`
            );

            // Create a new input with pin set to false
            const unpinnedInput = { ...input, pin: false };

            try {
              const unpinnedResult = await client.graphql(
                mutation,
                { definition: unpinnedInput },
                operationName
              );

              if (unpinnedResult.metafieldDefinitionCreate.userErrors.length > 0) {
                LoggingUtils.error(
                  `Failed to create unpinned ${this.resourceName} definition ${input.namespace}.${input.key}:`,
                  0,
                  unpinnedResult.metafieldDefinitionCreate.userErrors
                );
                return null;
              }

              return unpinnedResult.metafieldDefinitionCreate.createdDefinition;
            } catch (retryError) {
              LoggingUtils.error(
                `Error creating unpinned ${this.resourceName} definition ${input.namespace}.${input.key}: ${retryError.message}`
              );
              return null;
            }
          } else {
            // Handle other errors
            LoggingUtils.error(
              `Failed to create ${this.resourceName} definition ${input.namespace}.${input.key}:`,
              0,
              result.metafieldDefinitionCreate.userErrors
            );
            return null;
          }
        }
        return result.metafieldDefinitionCreate.createdDefinition;
      } catch (error) {
        LoggingUtils.error(`Error creating ${this.resourceName} definition ${input.namespace}.${input.key}: ${error.message}`);
        return null;
      }
    } else {
      LoggingUtils.dryRun(`Would create ${this.resourceName} definition ${input.namespace}.${input.key}`);
      return { id: "dry-run-id", namespace: input.namespace, key: input.key };
    }
  }

  async updateMetafieldDefinition(client, definition, existingDefinition) {
    const LoggingUtils = require('../utils/LoggingUtils');

    const input = {
      name: definition.name,
      description: definition.description || "",
      validations: definition.validations || [],
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
          LoggingUtils.error(
            `Failed to update ${this.resourceName} definition ${definition.namespace}.${definition.key}:`,
            0,
            result.metafieldDefinitionUpdate.userErrors
          );
          return null;
        }
        return result.metafieldDefinitionUpdate.updatedDefinition;
      } catch (error) {
        LoggingUtils.error(`Error updating ${this.resourceName} definition ${definition.namespace}.${definition.key}: ${error.message}`);
        return null;
      }
    } else {
      LoggingUtils.dryRun(`Would update ${this.resourceName} definition ${definition.namespace}.${definition.key}`);
      return { id: existingDefinition.id, namespace: definition.namespace, key: definition.key };
    }
  }

  async deleteMetafieldDefinition(client, definition) {
    const LoggingUtils = require('../utils/LoggingUtils');

    const definitionId = definition.id;
    if (!definitionId) {
      LoggingUtils.error(`Cannot delete ${this.resourceName} definition ${definition.namespace}.${definition.key}: missing ID`);
      return null;
    }

    const mutation = `#graphql
          mutation deleteMetafieldDefinition($id: ID!) {
            metafieldDefinitionDelete(id: $id) {
              deletedDefinitionId
              userErrors { field message code }
            }
          }
        `;
    const operationName = `Delete${this.ownerType}MetafieldDefinition`;

    if (this.options.notADrill) {
      try {
        const result = await client.graphql(mutation, { id: definitionId }, operationName);
        if (result.metafieldDefinitionDelete.userErrors.length > 0) {
          LoggingUtils.error(
            `Failed to delete ${this.resourceName} definition ${definition.namespace}.${definition.key}:`,
            0,
            result.metafieldDefinitionDelete.userErrors
          );
          return null;
        }
        return result.metafieldDefinitionDelete.deletedDefinitionId;
      } catch (error) {
        LoggingUtils.error(`Error deleting ${this.resourceName} definition ${definition.namespace}.${definition.key}: ${error.message}`);
        return null;
      }
    } else {
      LoggingUtils.dryRun(`Would delete ${this.resourceName} definition ${definition.namespace}.${definition.key}`);
      return definition.id || "dry-run-id";
    }
  }

  async getMetaobjectDefinitionTypeById(client, definitionId) {
    const LoggingUtils = require('../utils/LoggingUtils');

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
        LoggingUtils.warn(`Metaobject definition with ID ${definitionId} not found.`);
        return null;
      }
    } catch (error) {
      LoggingUtils.error(`Error fetching metaobject definition type for ID ${definitionId}: ${error.message}`);
      return null;
    }
  }

  async getMetaobjectDefinitionIdByType(client, definitionType) {
    const LoggingUtils = require('../utils/LoggingUtils');

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
        LoggingUtils.warn(`Metaobject definition with type ${definitionType} not found in target store.`);
        return null;
      }
    } catch (error) {
      LoggingUtils.error(`Error fetching metaobject definition ID for type ${definitionType}: ${error.message}`);
      return null;
    }
  }

  // --- Sync Orchestration Methods ---

  async syncDefinitionsOnly() {
    const LoggingUtils = require('../utils/LoggingUtils');

    // Handle deletion mode separately
    if (this.options.delete) {
      LoggingUtils.info(`Delete mode enabled. Fetching ${this.resourceName} definitions from target...`);

      const targetDefinitions = await this.fetchMetafieldDefinitions(this.targetClient, this.options.namespace, this.options.key);

      if (targetDefinitions.length === 0) {
        LoggingUtils.info(`No ${this.resourceName} definitions found in target to delete.`);
        return { results: { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0 }, definitionKeys: [] };
      }

      LoggingUtils.info(`Found ${targetDefinitions.length} definition(s) to delete in target.`);

      // Log each definition to be deleted
      LoggingUtils.indent();
      targetDefinitions.forEach(def => {
        LoggingUtils.info(`${def.namespace}.${def.key} (${def.name || 'unnamed'}): ${def.type.name}`, 0, 'main');
      });
      LoggingUtils.unindent();

      const results = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0 };
      let processedCount = 0;

      // Delete all target definitions
      for (const definition of targetDefinitions) {
        if (processedCount >= this.options.limit) {
          LoggingUtils.info(`Reached processing limit (${this.options.limit}). Stopping ${this.resourceName} definition deletion.`);
          break;
        }

        const definitionFullKey = `${definition.namespace}.${definition.key}`;
        LoggingUtils.info(`Deleting ${this.resourceName} definition: ${definitionFullKey}`);

        // Indent the dry run message to appear under the delete message
        LoggingUtils.indent();
        const deleted = await this.deleteMetafieldDefinition(this.targetClient, definition);
        LoggingUtils.unindent();

        if (deleted) {
          results.deleted++;
        } else {
          results.failed++;
        }

        processedCount++;
      }

      LoggingUtils.success(`Deleted ${results.deleted} definition(s) from target.`);
      return { results, definitionKeys: [] };
    }

    // Regular sync mode below (non-delete mode)
    const sourceDefinitions = await this.fetchMetafieldDefinitions(this.sourceClient, this.options.namespace, this.options.key);
    if (sourceDefinitions.length === 0) {
      LoggingUtils.warn(
        this.options.key
          ? `No ${this.resourceName} definitions found in source for key: ${this.options.key}`
          : `No ${this.resourceName} definitions found in source for namespace: ${this.options.namespace}`
      );
      return { results: { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0 }, definitionKeys: [] };
    }
    LoggingUtils.info(
      `Found ${sourceDefinitions.length} definition(s) in source ${
        this.options.key ? `for key ${this.options.key}` : this.options.namespace ? `for namespace ${this.options.namespace}` : ""
      }`
    );

    // Log each definition with its type
    LoggingUtils.indent();
    sourceDefinitions.forEach(def => {
      LoggingUtils.info(`${def.namespace}.${def.key} (${def.name || 'unnamed'}): ${def.type.name}`, 0, 'main');

      // Log validation rules if present
      if (def.validations && def.validations.length > 0) {
        LoggingUtils.indent();
        def.validations.forEach(validation => {
          LoggingUtils.info(`Validation: ${validation.name} = ${validation.value}`, 0, 'sub');
        });
        LoggingUtils.unindent();
      }
    });
    LoggingUtils.unindent();

    const targetDefinitions = await this.fetchMetafieldDefinitions(this.targetClient, this.options.namespace);
    LoggingUtils.info(`Found ${targetDefinitions.length} definition(s) in target (for namespace: ${this.options.namespace || "all"})`);
    const targetDefinitionMap = targetDefinitions.reduce((map, def) => {
      map[`${def.namespace}.${def.key}`] = def;
      return map;
    }, {});

    const results = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0 };
    const definitionKeys = [];
    let processedCount = 0;

    for (const definition of sourceDefinitions) {
      if (processedCount >= this.options.limit) {
        LoggingUtils.info(`Reached processing limit (${this.options.limit}). Stopping ${this.resourceName} definition sync.`);
        break;
      }
      const definitionFullKey = `${definition.namespace}.${definition.key}`;
      definitionKeys.push(definitionFullKey);

      // --- Resolve Metaobject References in Validations --- START ---
      let definitionToSync = { ...definition }; // Work on a copy
      let resolutionError = false;
      if ((definition.type.name === 'metaobject_reference' || definition.type.name === 'list.metaobject_reference') && definition.validations?.length > 0) {
        LoggingUtils.debug(`Resolving metaobject references for ${definitionFullKey}`);
        const resolvedValidations = [];
        for (const validation of definition.validations) {
          // Assuming the validation 'value' holds the GID for relevant rules
          // We might need a more robust check based on validation 'name'
          if (validation.value?.startsWith('gid://shopify/MetaobjectDefinition/')) {
            const sourceMoDefId = validation.value;
            const sourceMoDefType = await this.getMetaobjectDefinitionTypeById(this.sourceClient, sourceMoDefId);

            if (!sourceMoDefType) {
              LoggingUtils.error(`Failed to find type for source Metaobject Definition ID ${sourceMoDefId} referenced by ${definitionFullKey}. Skipping definition.`);
              resolutionError = true;
              break; // Stop processing validations for this definition
            }

            const targetMoDefId = await this.getMetaobjectDefinitionIdByType(this.targetClient, sourceMoDefType);

            if (!targetMoDefId) {
              LoggingUtils.error(`Failed to find target Metaobject Definition for type ${sourceMoDefType} (referenced by ${definitionFullKey}). Ensure it exists in the target store. Skipping definition.`);
              resolutionError = true;
              break; // Stop processing validations for this definition
            }

            LoggingUtils.debug(`  Mapping validation ref: ${sourceMoDefId} (type: ${sourceMoDefType}) -> ${targetMoDefId}`);
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
        LoggingUtils.info(`Updating ${this.resourceName} definition: ${definitionFullKey}`);
        // Indent the dry run message to appear under the update message
        LoggingUtils.indent();
        // Pass the potentially modified definitionToSync
        const updated = await this.updateMetafieldDefinition(this.targetClient, definitionToSync, targetDefinition);
        LoggingUtils.unindent();
        updated ? results.updated++ : results.failed++;
      } else {
        LoggingUtils.info(`Creating ${this.resourceName} definition: ${definitionFullKey}`);
        // Indent the dry run message to appear under the create message
        LoggingUtils.indent();
        // Pass the potentially modified definitionToSync
        const created = await this.createMetafieldDefinition(this.targetClient, definitionToSync);
        LoggingUtils.unindent();
        created ? results.created++ : results.failed++;
      }
      processedCount++;
    }

    return { results, definitionKeys };
  }

  async listAvailableDefinitions() {
    const LoggingUtils = require('../utils/LoggingUtils');

    LoggingUtils.info(`Fetching all available ${this.resourceName} definitions...`);
    const definitions = await this.fetchMetafieldDefinitions(this.sourceClient);
    if (definitions.length === 0) {
      LoggingUtils.warn(`No ${this.resourceName} definitions found in source shop.`);
      return;
    }

    // Group definitions by namespace
    const namespaceGroups = {};
    definitions.forEach(def => {
      if (!namespaceGroups[def.namespace]) {
        namespaceGroups[def.namespace] = [];
      }
      namespaceGroups[def.namespace].push(def);
    });

    LoggingUtils.info(`Available ${this.resourceName} namespaces/keys:`);

    // Reset indentation
    LoggingUtils.resetIndent();

    // Display namespaces and their keys with indentation
    Object.keys(namespaceGroups).sort().forEach(namespace => {
      LoggingUtils.info(`${namespace}:`, 0, 'main');
      LoggingUtils.indent();
      namespaceGroups[namespace].forEach(def => {
        LoggingUtils.info(`${def.key} (${def.name || "No name"})`, 0, 'sub');
      });
      LoggingUtils.unindent();
    });

    LoggingUtils.info(`\nPlease run the command again with --namespace <namespace> to specify which ${this.resourceName} namespace to sync.`);
    LoggingUtils.info(`Or use --namespace all to sync all namespaces at once.`);
  }

  async sync() {
    const LoggingUtils = require('../utils/LoggingUtils');

    // Handle listing if namespace is missing (relevant for metafield types)
    if (!this.options.namespace) {
      LoggingUtils.error(`Error: --namespace is required for ${this.resourceName} definitions sync.`);
      LoggingUtils.info(`Try running the command with --namespace <namespace> or --namespace all.`);
      await this.listAvailableDefinitions();
      return { definitionResults: null, dataResults: null };
    }

    let definitionResults = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0 };
    let dataResults = null; // Data sync not supported for metafields

    // If in delete mode, handle it differently
    if (this.options.delete) {
      // Handle the special "all" namespace case in delete mode
      if (this.options.namespace.toLowerCase() === 'all') {
        LoggingUtils.info(`Delete mode: Deleting all ${this.resourceName} namespaces...`);
        const definitions = await this.fetchMetafieldDefinitions(this.targetClient);
        if (definitions.length === 0) {
          LoggingUtils.warn(`No ${this.resourceName} definitions found in target shop.`);
          return { definitionResults, dataResults };
        }

        // Get unique namespaces
        const namespaces = [...new Set(definitions.map(def => def.namespace))];
        LoggingUtils.info(`Found ${namespaces.length} namespaces to delete: ${namespaces.join(', ')}`);

        // Preserve current indentation level when running multiple namespaces
        const currentIndent = LoggingUtils.indentLevel;

        // Delete each namespace separately
        for (const namespace of namespaces) {
          // Create a subsection for each namespace, indented under the resource type
          LoggingUtils.info(`NAMESPACE: ${namespace}`, 0, 'main');
          LoggingUtils.indent();

          // Temporarily set the namespace option
          const originalNamespace = this.options.namespace;
          this.options.namespace = namespace;

          // Run the sync for this namespace in delete mode
          const defSync = await this.syncDefinitionsOnly();

          // Restore the original "all" value
          this.options.namespace = originalNamespace;

          // Combine results
          definitionResults.deleted += defSync.results.deleted;
          definitionResults.failed += defSync.results.failed;

          LoggingUtils.success(`Finished deleting ${this.resourceName} definitions for namespace: ${namespace}.`);
          LoggingUtils.unindent();
        }

        // Restore original indentation level
        LoggingUtils.indentLevel = currentIndent;

        return { definitionResults, dataResults };
      }
      // Handle the comma-separated namespaces case in delete mode
      else if (this.options.namespaces && Array.isArray(this.options.namespaces)) {
        LoggingUtils.info(`Delete mode: Deleting multiple ${this.resourceName} namespaces: ${this.options.namespaces.join(', ')}...`);

        // Preserve current indentation level when running multiple namespaces
        const currentIndent = LoggingUtils.indentLevel;

        // Delete each namespace separately
        for (const namespace of this.options.namespaces) {
          // Create a subsection for each namespace, indented under the resource type
          LoggingUtils.info(`NAMESPACE: ${namespace}`, 0, 'main');
          LoggingUtils.indent();

          // Temporarily set the namespace option
          const originalNamespace = this.options.namespace;
          this.options.namespace = namespace;

          // Run the sync for this namespace in delete mode
          const defSync = await this.syncDefinitionsOnly();

          // Restore the original value
          this.options.namespace = originalNamespace;

          // Combine results
          definitionResults.deleted += defSync.results.deleted;
          definitionResults.failed += defSync.results.failed;

          LoggingUtils.success(`Finished deleting ${this.resourceName} definitions for namespace: ${namespace}.`);
          LoggingUtils.unindent();
        }

        // Restore original indentation level
        LoggingUtils.indentLevel = currentIndent;

        return { definitionResults, dataResults };
      }

      // Single namespace delete mode
      LoggingUtils.info(`Delete mode: Deleting ${this.resourceName} definitions for namespace: ${this.options.namespace}...`);
      const defSync = await this.syncDefinitionsOnly();
      definitionResults = defSync.results;
      LoggingUtils.success(`Finished deleting ${this.resourceName} definitions.`);
      return { definitionResults, dataResults };
    }

    // Regular sync mode (non-delete) below
    // Handle the special "all" namespace case
    if (this.options.namespace.toLowerCase() === 'all') {
      LoggingUtils.info(`Syncing all ${this.resourceName} namespaces...`);
      const definitions = await this.fetchMetafieldDefinitions(this.sourceClient);
      if (definitions.length === 0) {
        LoggingUtils.warn(`No ${this.resourceName} definitions found in source shop.`);
        return { definitionResults, dataResults };
      }

      // Get unique namespaces
      const namespaces = [...new Set(definitions.map(def => def.namespace))];
      LoggingUtils.info(`Found ${namespaces.length} namespaces to sync: ${namespaces.join(', ')}`);

      // Preserve current indentation level when running multiple namespaces
      const currentIndent = LoggingUtils.indentLevel;

      // Sync each namespace separately
      for (const namespace of namespaces) {
        // Create a subsection for each namespace, indented under the resource type
        LoggingUtils.info(`NAMESPACE: ${namespace}`, 0, 'main');
        LoggingUtils.indent();

        // Temporarily set the namespace option
        const originalNamespace = this.options.namespace;
        this.options.namespace = namespace;

        // Run the sync for this namespace
        const defSync = await this.syncDefinitionsOnly();

        // Restore the original "all" value
        this.options.namespace = originalNamespace;

        // Combine results
        definitionResults.created += defSync.results.created;
        definitionResults.updated += defSync.results.updated;
        definitionResults.skipped += defSync.results.skipped;
        definitionResults.failed += defSync.results.failed;
        definitionResults.deleted += defSync.results.deleted;

        LoggingUtils.success(`Finished syncing ${this.resourceName} definitions for namespace: ${namespace}.`);
        LoggingUtils.unindent();
      }

      // Restore original indentation level
      LoggingUtils.indentLevel = currentIndent;

      return { definitionResults, dataResults };
    }
    // Handle the comma-separated namespaces case
    else if (this.options.namespaces && Array.isArray(this.options.namespaces)) {
      LoggingUtils.info(`Syncing multiple ${this.resourceName} namespaces: ${this.options.namespaces.join(', ')}...`);

      // Preserve current indentation level when running multiple namespaces
      const currentIndent = LoggingUtils.indentLevel;

      // Sync each namespace separately
      for (const namespace of this.options.namespaces) {
        // Create a subsection for each namespace, indented under the resource type
        LoggingUtils.info(`NAMESPACE: ${namespace}`, 0, 'main');
        LoggingUtils.indent();

        // Temporarily set the namespace option
        const originalNamespace = this.options.namespace;
        this.options.namespace = namespace;

        // Run the sync for this namespace
        const defSync = await this.syncDefinitionsOnly();

        // Restore the original value
        this.options.namespace = originalNamespace;

        // Combine results
        definitionResults.created += defSync.results.created;
        definitionResults.updated += defSync.results.updated;
        definitionResults.skipped += defSync.results.skipped;
        definitionResults.failed += defSync.results.failed;
        definitionResults.deleted += defSync.results.deleted;

        LoggingUtils.success(`Finished syncing ${this.resourceName} definitions for namespace: ${namespace}.`);
        LoggingUtils.unindent();
      }

      // Restore original indentation level
      LoggingUtils.indentLevel = currentIndent;

      return { definitionResults, dataResults };
    }

    // Only definition sync is supported for metafields
    if (!this.options.dataOnly) {
      LoggingUtils.info(`Syncing ${this.resourceName} definitions...`);
      const defSync = await this.syncDefinitionsOnly();
      definitionResults = defSync.results;
      LoggingUtils.success(`Finished syncing ${this.resourceName} definitions.`);
    } else {
      // This case should ideally be caught by run.js validation
      LoggingUtils.error(`Data sync (--data-only) is not supported for ${this.resourceName}s.`);
      return { definitionResults: null, dataResults: null };
    }

    // No data sync part for metafields
    return { definitionResults, dataResults };
  }
}

module.exports = BaseMetafieldSyncStrategy;
