const logger = require("../utils/logger");
const chalk = require('chalk');
const ErrorHandler = require('../utils/ErrorHandler');

// Import GraphQL queries and mutations
const {
  FetchMetafieldDefinitions,
  CreateMetafieldDefinition,
  UpdateMetafieldDefinition,
  DeleteMetafieldDefinition,
  GetMetaobjectDefinitionType,
  GetMetaobjectDefinitionId
} = require('../graphql');

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
        // Key includes namespace (e.g., "namespace.key")
        // Extract just the key part after the namespace
        definitionKey = parts.slice(1).join(".");

        // If namespace wasn't provided but is in the key, extract it
        if (!namespace) {
          namespace = parts[0];
          logger.info(`Using namespace "${namespace}" from the provided key`);
        }
      } else {
        // Key doesn't include namespace, use as-is
        definitionKey = key;
        logger.info(`Using key "${definitionKey}" with namespace "${namespace}"`);
      }
    }

    const variables = { ownerType: this.ownerType };
    if (namespace) variables.namespace = namespace;
    if (definitionKey !== null) variables.key = definitionKey;

    if (this.options.debug) {
      logger.info(`Fetching metafield definitions with: namespace=${namespace}, key=${definitionKey}`);
    }

    const operationName = `Fetch${this.ownerType}MetafieldDefinitions`;
    try {
      const response = await client.graphql(FetchMetafieldDefinitions, variables, operationName);
      return response.metafieldDefinitions.nodes;
    } catch (error) {
      logger.error(`Error fetching ${this.resourceName} definitions: ${error.message}`);
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
      pin: definition.pinnedPosition != null && definition.pinnedPosition >= 0
    };

    // Only add capabilities that are supported for this metafield type
    // AND are enabled in the source definition
    const capabilities = {};

    // Check if smart collection capability should be enabled
    if (definition.capabilities?.smartCollectionCondition?.enabled === true &&
        this.shouldEnableSmartCollectionCapability(definition.type.name)) {
      capabilities.smartCollectionCondition = { enabled: true };
    }

    // Check if admin filterable capability should be enabled
    if (definition.capabilities?.adminFilterable?.enabled === true &&
        this.shouldEnableAdminFilterableCapability(definition.type.name)) {
      capabilities.adminFilterable = { enabled: true };
    }

    // Check if unique values capability should be enabled
    if (definition.capabilities?.uniqueValues?.enabled === true &&
        this.options.enableUniqueValues &&
        this.shouldEnableUniqueValuesCapability(definition.type.name)) {
      capabilities.uniqueValues = { enabled: true };
    }

    // Only add capabilities if we have any to add
    if (Object.keys(capabilities).length > 0) {
      input.capabilities = capabilities;
    }

    const operationName = `Create${this.ownerType}MetafieldDefinition`;
    if (this.options.notADrill) {
      try {
        logger.info(`Sending API request to create metafield definition: ${input.namespace}.${input.key}`);
        const result = await client.graphql(CreateMetafieldDefinition, { definition: input }, operationName);

        if (result.metafieldDefinitionCreate.userErrors.length > 0) {
          // Use ErrorHandler to handle user errors
          ErrorHandler.handleGraphQLUserErrors(
            result.metafieldDefinitionCreate.userErrors,
            [input], // The item array (in this case just one item)
            (item, index, field) => ({
              itemName: `${this.resourceName} definition ${item.namespace}.${item.key}`,
              valuePreview: field && field.length > 2 ? JSON.stringify(item[field[2]]) : null
            }),
            `${this.resourceName} definition`
          );

          // Check if the error is due to the pinned limit being reached
          const pinnedLimitError = result.metafieldDefinitionCreate.userErrors.find(
            error => error.code === 'PINNED_LIMIT_REACHED'
          );

          if (pinnedLimitError && input.pin) {
            // If pinned limit reached and we tried to create a pinned definition,
            // retry with pin: false
            logger.warn(
              `Pinned limit reached for ${this.resourceName} definition ${input.namespace}.${input.key}. Retrying as unpinned.`
            );

            // Create a new input with pin set to false
            const unpinnedInput = { ...input, pin: false };

            try {
              const unpinnedResult = await client.graphql(
                CreateMetafieldDefinition,
                { definition: unpinnedInput },
                operationName
              );

              if (unpinnedResult.metafieldDefinitionCreate.userErrors.length > 0) {
                // Use ErrorHandler for the retry errors too
                ErrorHandler.handleGraphQLUserErrors(
                  unpinnedResult.metafieldDefinitionCreate.userErrors,
                  [unpinnedInput],
                  (item, index, field) => ({
                    itemName: `unpinned ${this.resourceName} definition ${item.namespace}.${item.key}`,
                    valuePreview: field && field.length > 2 ? JSON.stringify(item[field[2]]) : null
                  }),
                  `unpinned ${this.resourceName} definition`
                );
                return null;
              }

              return unpinnedResult.metafieldDefinitionCreate.createdDefinition;
            } catch (retryError) {
              logger.error(`Error creating unpinned ${this.resourceName} definition ${input.namespace}.${input.key}: ${retryError.message}`);
              return null;
            }
          }

          return null;
        }
        return result.metafieldDefinitionCreate.createdDefinition;
      } catch (error) {
        logger.error(`Error creating ${this.resourceName} definition ${input.namespace}.${input.key}: ${error.message}`);

        // Log the GraphQL errors if available
        if (error.graphQLErrors && error.graphQLErrors.length) {
          logger.error('GraphQL API errors:');
          logger.indent();
          error.graphQLErrors.forEach(err => {
            logger.error(err.message);
          });
          logger.unindent();
        }

        return null;
      }
    } else {
      logger.dryRun(`Would create ${this.resourceName} definition ${input.namespace}.${input.key}`);
      return { id: "dry-run-id", namespace: input.namespace, key: input.key };
    }
  }

  async updateMetafieldDefinition(client, definition, existingDefinition) {
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

    // Only add capabilities that are supported for this metafield type
    // AND are enabled in the source definition
    const capabilities = {};

    // Check if smart collection capability should be enabled
    if (definition.capabilities?.smartCollectionCondition?.enabled === true &&
        this.shouldEnableSmartCollectionCapability(definition.type.name)) {
      capabilities.smartCollectionCondition = { enabled: true };
    }

    // Check if admin filterable capability should be enabled
    if (definition.capabilities?.adminFilterable?.enabled === true &&
        this.shouldEnableAdminFilterableCapability(definition.type.name)) {
      capabilities.adminFilterable = { enabled: true };
    }

    // Check if unique values capability should be enabled
    if (definition.capabilities?.uniqueValues?.enabled === true &&
        this.options.enableUniqueValues &&
        this.shouldEnableUniqueValuesCapability(definition.type.name)) {
      capabilities.uniqueValues = { enabled: true };
    }

    // Only add capabilities if we have any to add
    if (Object.keys(capabilities).length > 0) {
      input.capabilities = capabilities;
    }

    const operationName = `Update${this.ownerType}MetafieldDefinition`;
    if (this.options.notADrill) {
      try {
        const result = await client.graphql(UpdateMetafieldDefinition, { definition: input }, operationName);
        if (result.metafieldDefinitionUpdate.userErrors.length > 0) {
          // Use ErrorHandler to handle user errors
          ErrorHandler.handleGraphQLUserErrors(
            result.metafieldDefinitionUpdate.userErrors,
            [input], // The item array (in this case just one item)
            (item, index, field) => ({
              itemName: `${this.resourceName} definition ${item.namespace}.${item.key}`,
              valuePreview: field && field.length > 2 ? JSON.stringify(item[field[2]]) : null
            }),
            `${this.resourceName} definition update`
          );

          // Check if the error is due to the pinned limit being reached
          const pinnedLimitError = result.metafieldDefinitionUpdate.userErrors.find(
            error => error.code === 'PINNED_LIMIT_REACHED'
          );

          if (pinnedLimitError && input.pin) {
            // If pinned limit reached and we tried to update to a pinned definition,
            // retry with pin: false
            logger.warn(
              `Pinned limit reached for ${this.resourceName} definition ${input.namespace}.${input.key}. Retrying as unpinned.`
            );

            // Create a new input with pin set to false
            const unpinnedInput = { ...input, pin: false };

            try {
              const unpinnedResult = await client.graphql(
                UpdateMetafieldDefinition,
                { definition: unpinnedInput },
                operationName
              );

              if (unpinnedResult.metafieldDefinitionUpdate.userErrors.length > 0) {
                // Use ErrorHandler for the retry errors too
                ErrorHandler.handleGraphQLUserErrors(
                  unpinnedResult.metafieldDefinitionUpdate.userErrors,
                  [unpinnedInput],
                  (item, index, field) => ({
                    itemName: `unpinned ${this.resourceName} definition ${item.namespace}.${item.key}`,
                    valuePreview: field && field.length > 2 ? JSON.stringify(item[field[2]]) : null
                  }),
                  `unpinned ${this.resourceName} definition update`
                );
                return null;
              }

              return unpinnedResult.metafieldDefinitionUpdate.updatedDefinition;
            } catch (retryError) {
              logger.error(
                `Error updating unpinned ${this.resourceName} definition ${input.namespace}.${input.key}: ${retryError.message}`
              );
              return null;
            }
          }

          return null;
        }
        return result.metafieldDefinitionUpdate.updatedDefinition;
      } catch (error) {
        logger.error(`Error updating ${this.resourceName} definition ${definition.namespace}.${definition.key}: ${error.message}`);

        // Log the GraphQL errors if available
        if (error.graphQLErrors && error.graphQLErrors.length) {
          logger.error('GraphQL API errors:');
          logger.indent();
          error.graphQLErrors.forEach(err => {
            logger.error(err.message);
          });
          logger.unindent();
        }

        return null;
      }
    } else {
      logger.dryRun(`Would update ${this.resourceName} definition ${definition.namespace}.${definition.key}`);
      return { id: existingDefinition.id, namespace: definition.namespace, key: definition.key };
    }
  }

  async deleteMetafieldDefinition(client, definition) {
    const definitionId = definition.id;
    if (!definitionId) {
      logger.error(`Cannot delete ${this.resourceName} definition ${definition.namespace}.${definition.key}: missing ID`);
      return null;
    }

    const operationName = `Delete${this.ownerType}MetafieldDefinition`;

    if (this.options.notADrill) {
      try {
        const result = await client.graphql(DeleteMetafieldDefinition, { id: definitionId }, operationName);
        if (result.metafieldDefinitionDelete.userErrors.length > 0) {
          logger.error(
            `Failed to delete ${this.resourceName} definition ${definition.namespace}.${definition.key}:`,
            0,
            result.metafieldDefinitionDelete.userErrors
          );
          return null;
        }
        return result.metafieldDefinitionDelete.deletedDefinitionId;
      } catch (error) {
        logger.error(`Error deleting ${this.resourceName} definition ${definition.namespace}.${definition.key}: ${error.message}`);
        return null;
      }
    } else {
      logger.dryRun(`Would delete ${this.resourceName} definition ${definition.namespace}.${definition.key}`);
      return definition.id || "dry-run-id";
    }
  }

  async getMetaobjectDefinitionTypeById(client, definitionId) {
    try {
      const response = await client.graphql(GetMetaobjectDefinitionType, { id: definitionId }, "GetMetaobjectDefinitionType");
      if (response.metaobjectDefinition) {
        return response.metaobjectDefinition.type;
      } else {
        logger.warn(`Metaobject definition with ID ${definitionId} not found.`);
        return null;
      }
    } catch (error) {
      logger.error(`Error fetching metaobject definition type for ID ${definitionId}: ${error.message}`);
      return null;
    }
  }

  async getMetaobjectDefinitionIdByType(client, definitionType) {
    try {
      const response = await client.graphql(GetMetaobjectDefinitionId, { type: definitionType }, "GetMetaobjectDefinitionId");
      if (response.metaobjectDefinitionByType) {
        return response.metaobjectDefinitionByType.id;
      } else {
        logger.warn(`Metaobject definition with type ${definitionType} not found in target store.`);
        return null;
      }
    } catch (error) {
      logger.error(`Error fetching metaobject definition ID for type ${definitionType}: ${error.message}`);
      return null;
    }
  }

  // --- Sync Orchestration Methods ---

  async syncDefinitionsOnly() {
    // Handle deletion mode separately
    if (this.options.delete) {
      logger.startSection(`Delete mode: Fetching ${this.resourceName} definitions from target...`);

      const targetDefinitions = await this.fetchMetafieldDefinitions(this.targetClient, this.options.namespace, this.options.key);

      if (targetDefinitions.length === 0) {
        logger.info(`No ${this.resourceName} definitions found in target to delete.`);
        logger.endSection();
        return { results: { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0 }, definitionKeys: [] };
      }

      logger.info(`Found ${targetDefinitions.length} definition(s) to delete in target.`);

      // Log each definition to be deleted
      logger.indent();
      targetDefinitions.forEach(def => {
        logger.info(`${def.namespace}.${def.key} (${def.name || 'unnamed'}): ${def.type.name}`, 0, 'main');
      });
      logger.unindent();

      const results = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0 };
      let processedCount = 0;

      logger.startSection("Deleting definitions");

      // Delete all target definitions
      for (const definition of targetDefinitions) {
        if (processedCount >= this.options.limit) {
          logger.info(`Reached processing limit (${this.options.limit}). Stopping ${this.resourceName} definition deletion.`);
          break;
        }

        const definitionFullKey = `${definition.namespace}.${definition.key}`;
        logger.info(`Deleting ${this.resourceName} definition: ${definitionFullKey}`);

        // Indent the dry run message to appear under the delete message
        logger.indent();
        const deleted = await this.deleteMetafieldDefinition(this.targetClient, definition);

        if (deleted) {
          results.deleted++;
          logger.success(`Successfully deleted ${this.resourceName} definition: ${definitionFullKey}`);
        } else {
          results.failed++;
        }

        logger.unindent();

        processedCount++;
      }

      logger.endSection(`Deleted ${results.deleted} definition(s) from target.`);

      return { results, definitionKeys: [] };
    }

    // Regular sync mode below (non-delete mode)
    logger.startSection(`Fetching source ${this.resourceName} definitions`);
    const sourceDefinitions = await this.fetchMetafieldDefinitions(this.sourceClient, this.options.namespace, this.options.key);
    if (sourceDefinitions.length === 0) {
      logger.warn(
        this.options.key
          ? `No ${this.resourceName} definitions found in source for key: ${this.options.key}`
          : `No ${this.resourceName} definitions found in source for namespace: ${this.options.namespace}`
      );
      logger.endSection();
      return { results: { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0 }, definitionKeys: [] };
    }
    logger.info(
      `Found ${sourceDefinitions.length} definition(s) in source ${
        this.options.key ? `for key ${this.options.key}` : this.options.namespace ? `for namespace ${this.options.namespace}` : ""
      }`
    );

    logger.endSection();

    logger.startSection(`Fetching target ${this.resourceName} definitions`);
    const targetDefinitions = await this.fetchMetafieldDefinitions(this.targetClient, this.options.namespace);
    logger.info(`Found ${targetDefinitions.length} definition(s) in target (for namespace: ${this.options.namespace || "all"})`);
    const targetDefinitionMap = targetDefinitions.reduce((map, def) => {
      map[`${def.namespace}.${def.key}`] = def;
      return map;
    }, {});
    logger.endSection();

    const results = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0 };
    const definitionKeys = [];
    let processedCount = 0;

    logger.startSection(`Processing ${this.resourceName} definitions`);

    for (const definition of sourceDefinitions) {
      if (processedCount >= this.options.limit) {
        logger.info(`Reached processing limit (${this.options.limit}). Stopping ${this.resourceName} definition sync.`);
        break;
      }
      const definitionFullKey = `${definition.namespace}.${definition.key}`;
      definitionKeys.push(definitionFullKey);

      // --- Resolve Metaobject References in Validations --- START ---
      let definitionToSync = { ...definition }; // Work on a copy
      let resolutionError = false;
      if ((definition.type.name === 'metaobject_reference' || definition.type.name === 'list.metaobject_reference') && definition.validations?.length > 0) {
        logger.startSection(`Resolving metaobject references for ${chalk.bold(definitionFullKey)}`);
        const resolvedValidations = [];
        for (const validation of definition.validations) {
          // Assuming the validation 'value' holds the GID for relevant rules
          // We might need a more robust check based on validation 'name'
          if (validation.value?.startsWith('gid://shopify/MetaobjectDefinition/')) {
            const sourceMoDefId = validation.value;
            const sourceMoDefType = await this.getMetaobjectDefinitionTypeById(this.sourceClient, sourceMoDefId);

            if (!sourceMoDefType) {
              logger.warn(`Failed to find type for source Metaobject Definition ID ${sourceMoDefId} referenced by ${chalk.bold(definitionFullKey)}.`);
              resolutionError = true;
              break; // Stop processing validations for this definition
            }

            const targetMoDefId = await this.getMetaobjectDefinitionIdByType(this.targetClient, sourceMoDefType);

            if (!targetMoDefId) {
              logger.warn(`Metaobject definition with type ${sourceMoDefType} not found in target store.`);
              logger.error(`Failed to find target Metaobject Definition for type ${sourceMoDefType} (referenced by ${chalk.bold(definitionFullKey)}). Ensure it exists in the target store. Skipping definition.`);
              resolutionError = true;
              break; // Stop processing validations for this definition
            }

            logger.info(`Mapping validation ref: ${sourceMoDefId} -> ${targetMoDefId}`);
            resolvedValidations.push({ ...validation, value: targetMoDefId });
          } else {
            resolvedValidations.push(validation); // Keep non-reference validations as is
          }
        }

        if (!resolutionError) {
          definitionToSync.validations = resolvedValidations;
        }
        logger.endSection();
      }
      // --- Resolve Metaobject References in Validations --- END ---

      if (resolutionError) {
        results.failed++; // Mark as failed if resolution failed
        processedCount++;
        continue; // Skip to the next definition
      }

      const targetDefinition = targetDefinitionMap[definitionFullKey];

      if (targetDefinition) {
        logger.info(`Updating ${this.resourceName} definition: ${chalk.bold(definitionFullKey)}`);

        // Increase indentation for update operation and output
        logger.indent();

        // Pass the potentially modified definitionToSync
        const updated = await this.updateMetafieldDefinition(this.targetClient, definitionToSync, targetDefinition);

        if (updated) {
          results.updated++;
          logger.success(`Successfully updated ${this.resourceName} definition: ${chalk.bold(definitionFullKey)}`);
        } else {
          results.failed++;
        }

        logger.unindent();
      } else {
        logger.info(`Creating ${this.resourceName} definition: ${chalk.bold(definitionFullKey)}`);

        // Increase indentation for create operation and output
        logger.indent();

        // Pass the potentially modified definitionToSync
        const created = await this.createMetafieldDefinition(this.targetClient, definitionToSync);

        if (created) {
          results.created++;
          logger.success(`Successfully created ${this.resourceName} definition: ${chalk.bold(definitionFullKey)}`);
        } else {
          results.failed++;
          // Remove the incorrect message about metaobject definition not existing
          if (definitionFullKey === 'custom.banner_overlay') {
            logger.error(`Failed to create ${this.resourceName} definition ${chalk.bold(definitionFullKey)}. Please check the Shopify Admin API response in the logs above for specific error details.`);
          }
        }

        logger.unindent();
      }
      processedCount++;
    }

    logger.endSection(`Processed ${processedCount} ${this.resourceName} definition(s)`);

    return { results, definitionKeys };
  }

  async listAvailableDefinitions() {
    logger.info(`Fetching all available ${this.resourceName} definitions...`);
    const definitions = await this.fetchMetafieldDefinitions(this.sourceClient);
    if (definitions.length === 0) {
      logger.warn(`No ${this.resourceName} definitions found in source shop.`);
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

    logger.info(`Available ${this.resourceName} namespaces/keys:`);

    // Reset indentation
    logger.resetIndent();

    // Add blank line before listing namespaces
    logger.newline();

    // Display namespaces and their keys with indentation
    Object.keys(namespaceGroups).sort().forEach(namespace => {
      // Get current indent and log with purple color
      const indent = logger.getIndent();
      logger.info(`Found Namespace: ${chalk.magenta.bold(`${namespace}`)}`);

      // Increase indentation for contents under this namespace
      logger.indent();

      namespaceGroups[namespace].forEach(def => {
        logger.info(`${def.key} (${def.name || "No name"})`);
      });

      logger.unindent();
    });

    logger.info(`\nPlease run the command again with --namespace <namespace> to specify which ${this.resourceName} namespace to sync.`);
    logger.info(`Or use --namespace all to sync all namespaces at once.`);
  }

  /**
   * Log a namespace heading with proper formatting
   * @param {string} namespace - Namespace name
   */
  async logNamespaceHeading(namespace) {
    // Get current indent and log with purple color
    const indent = logger.getIndent();
    logger.info(`${indent}Found Namespace: ${chalk.magenta.bold(`${namespace}`)}`);

    // Increase indentation for everything under this namespace
    logger.indent();
  }

  async sync() {
    // Handle listing if namespace is missing (relevant for metafield types)
    if (!this.options.namespace) {
      logger.error(`Error: --namespace is required for ${this.resourceName} definitions sync.`);
      logger.info(`Try running the command with --namespace <namespace> or --namespace all.`);
      await this.listAvailableDefinitions();
      return { definitionResults: null, dataResults: null };
    }

    let definitionResults = { created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0 };
    let dataResults = null; // Data sync not supported for metafields

    // If in delete mode, handle it differently
    if (this.options.delete) {
      // Handle the special "all" namespace case in delete mode
      if (this.options.namespace.toLowerCase() === 'all') {
        logger.startSection(`Delete mode: Deleting all ${this.resourceName} namespaces`);
        const definitions = await this.fetchMetafieldDefinitions(this.targetClient);
        if (definitions.length === 0) {
          logger.warn(`No ${this.resourceName} definitions found in target shop.`);
          logger.endSection();
          return { definitionResults, dataResults };
        }

        // Get unique namespaces
        const namespaces = [...new Set(definitions.map(def => def.namespace))];
        logger.info(`Found ${namespaces.length} namespaces to delete: ${namespaces.join(', ')}`);

        // Delete each namespace separately
        for (const namespace of namespaces) {
          // Create a subsection for each namespace with purple heading
          (`Deleting namespace: ${chalk.magenta.bold(namespace)}`);

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

          logger.endSection(`Finished deleting ${this.resourceName} definitions for namespace: ${namespace}`);
        }

        logger.endSection(`Deleted definitions from ${namespaces.length} namespaces`);
        return { definitionResults, dataResults };
      }
      // Handle the comma-separated namespaces case in delete mode
      else if (this.options.namespaces && Array.isArray(this.options.namespaces)) {
        logger.startSection(`Delete mode: Deleting multiple ${this.resourceName} namespaces: ${this.options.namespaces.join(', ')}`);

        // Delete each namespace separately
        for (const namespace of this.options.namespaces) {
          // Create a subsection for each namespace with purple heading
          logger.startSection(`Deleting namespace: ${chalk.magenta.bold(namespace)}`);

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

          logger.endSection(`Finished deleting ${this.resourceName} definitions for namespace: ${namespace}`);
        }

        logger.endSection(`Deleted definitions from ${this.options.namespaces.length} namespaces`);
        return { definitionResults, dataResults };
      }

      // Single namespace delete mode
      logger.startSection(`Delete mode: Deleting ${this.resourceName} definitions for namespace: ${this.options.namespace}`);
      const defSync = await this.syncDefinitionsOnly();
      definitionResults = defSync.results;
      logger.endSection(`Finished deleting ${this.resourceName} definitions`);
      return { definitionResults, dataResults };
    }

    // Regular sync mode (non-delete) below
    // Handle the special "all" namespace case
    if (this.options.namespace.toLowerCase() === 'all') {
      logger.startSection(`Syncing all ${this.resourceName} namespaces`);
      const definitions = await this.fetchMetafieldDefinitions(this.sourceClient);
      if (definitions.length === 0) {
        logger.warn(`No ${this.resourceName} definitions found in source shop.`);
        logger.endSection();
        return { definitionResults, dataResults };
      }

      // Get unique namespaces
      const namespaces = [...new Set(definitions.map(def => def.namespace))];
      logger.info(`Found ${namespaces.length} namespaces to sync: ${namespaces.join(', ')}`);

      // Sync each namespace separately
      for (const namespace of namespaces) {
        // Create a subsection for each namespace with purple heading
        logger.startSection(`Syncing namespace: ${chalk.magenta.bold(namespace)}`);

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

        logger.endSection(`Finished syncing ${this.resourceName} definitions for namespace: ${namespace}`);
      }

      logger.endSection(`Synced definitions from ${namespaces.length} namespaces`);
      return { definitionResults, dataResults };
    }
    // Handle the comma-separated namespaces case
    else if (this.options.namespaces && Array.isArray(this.options.namespaces)) {
      logger.startSection(`Syncing multiple ${this.resourceName} namespaces: ${this.options.namespaces.join(', ')}`);

      // Sync each namespace separately
      for (const namespace of this.options.namespaces) {
        // Create a subsection for each namespace with purple heading
        logger.startSection(`Syncing namespace: ${chalk.magenta.bold(namespace)}`);

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

        logger.endSection(`Finished syncing ${this.resourceName} definitions for namespace: ${namespace}`);
      }

      logger.endSection(`Synced definitions from ${this.options.namespaces.length} namespaces`);
      return { definitionResults, dataResults };
    }

    // Only definition sync is supported for metafields
    if (!this.options.dataOnly) {
      logger.startSection(`Syncing ${this.resourceName} definitions for namespace: ${this.options.namespace}`);
      const defSync = await this.syncDefinitionsOnly();
      definitionResults = defSync.results;
      logger.endSection(`Finished syncing ${this.resourceName} definitions`);
    } else {
      // This case should ideally be caught by run.js validation
      logger.error(`Data sync (--data-only) is not supported for ${this.resourceName}s.`);
      return { definitionResults: null, dataResults: null };
    }

    // No data sync part for metafields
    return { definitionResults, dataResults };
  }

  /**
   * Determine if a metafield type supports smart collection capability
   * @param {string} metafieldType - The metafield type
   * @returns {boolean} - Whether the type supports smart collection capability
   */
  shouldEnableSmartCollectionCapability(metafieldType) {
    const supportedTypes = [
      'boolean',
      'number_integer',
      'number_decimal',
      'rating',
      'single_line_text_field',
      'metaobject_reference'
    ];
    return supportedTypes.includes(metafieldType);
  }

  /**
   * Determine if a metafield type supports admin filterable capability
   * @param {string} metafieldType - The metafield type
   * @returns {boolean} - Whether the type supports admin filterable capability
   */
  shouldEnableAdminFilterableCapability(metafieldType) {
    const supportedTypes = [
      'boolean',
      'single_line_text_field',
      'list.single_line_text_field',
      'product_reference',
      'list.product_reference',
      'collection_reference',
      'list.collection_reference',
      'page_reference',
      'list.page_reference',
      'metaobject_reference',
      'list.metaobject_reference',
      'company_reference',
      'list.company_reference'
    ];
    return supportedTypes.includes(metafieldType);
  }

  /**
   * Determine if a metafield type supports unique values capability
   * @param {string} metafieldType - The metafield type
   * @returns {boolean} - Whether the type supports unique values capability
   */
  shouldEnableUniqueValuesCapability(metafieldType) {
    const supportedTypes = [
      'single_line_text_field',
      'url',
      'number_integer'
    ];
    return supportedTypes.includes(metafieldType);
  }
}

module.exports = BaseMetafieldSyncStrategy;
