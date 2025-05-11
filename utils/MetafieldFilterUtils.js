const logger = require("./logger");
/**
 * Metafield Filter Utilities
 *
 * Provides utilities for filtering metafields based on namespace and key constraints.
 */

class MetafieldFilterUtils {
  /**
   * Filter metafields based on namespace and key options
   * @param {Array} metafields - Array of metafields to filter
   * @param {Object} options - Filtering options
   * @returns {Array} - Filtered metafields
   */
  static filterMetafields(metafields, options) {
    if (!metafields || metafields.length === 0) {
      return [];
    }

    if (!options.namespace && !options.namespaces && !options.key) {
      return metafields;
    }

    // Special case: if namespace is 'all', don't filter by namespace
    if (options.namespace && options.namespace.toLowerCase() === 'all') {
      logger.info(`Using special namespace 'all' - including all namespaces`, 4);

      // Only filter by key if provided
      if (options.key) {
        logger.info(`Filtering metafields by key: ${options.key}`, 4);

        const filteredByKey = metafields.filter(metafield => {
          // Handle case where key includes namespace (namespace.key format)
          if (options.key.includes('.')) {
            const [keyNamespace, keyName] = options.key.split('.');
            return metafield.namespace === keyNamespace && metafield.key === keyName;
          } else {
            // Key without namespace
            return metafield.key === options.key;
          }
        });

        logger.info(`Filtered from ${metafields.length} to ${filteredByKey.length} metafields`, 4);
        return filteredByKey;
      }

      return metafields; // Return all metafields when namespace is 'all' and no key filter
    }

    let logMessage = '';

    if (options.namespace) {
      logMessage += `namespace: ${options.namespace} `;
    } else if (options.namespaces) {
      logMessage += `namespaces: ${options.namespaces.join(', ')} `;
    }

    if (options.key) {
      logMessage += `key: ${options.key}`;
    }

    logger.info(`Filtering metafields by ${logMessage}`, 4);

    const filteredMetafields = metafields.filter(metafield => {
      // Filter by namespace if provided
      if (options.namespace && metafield.namespace !== options.namespace) {
        // Single namespace doesn't match
        return false;
      }

      // Filter by namespaces array if provided
      if (options.namespaces && Array.isArray(options.namespaces) &&
          !options.namespaces.includes(metafield.namespace)) {
        // Metafield namespace is not in the provided namespaces array
        return false;
      }

      // Filter by key if provided
      if (options.key) {
        // Handle case where key includes namespace (namespace.key format)
        if (options.key.includes('.')) {
          const [keyNamespace, keyName] = options.key.split('.');
          return metafield.namespace === keyNamespace && metafield.key === keyName;
        } else {
          // Key without namespace
          return metafield.key === options.key;
        }
      }

      return true;
    });

    logger.info(`Filtered from ${metafields.length} to ${filteredMetafields.length} metafields`, 4);
    return filteredMetafields;
  }
}

module.exports = MetafieldFilterUtils;
