const Shopify = require('shopify-api-node');
const consola = require('consola');

class ShopifyClientWrapper {
  /**
   * Wraps a shopify-api-node client instance to provide centralized debugging.
   * @param {Shopify} client - An instance of the shopify-api-node client.
   * @param {boolean} debug - Whether debug logging is enabled.
   */
  constructor(client, debug = false) {
    if (!client) {
      throw new Error("Shopify client instance is required.");
    }
    this.client = client;
    this.debug = debug;
    this.operationCounter = 0; // To help correlate logs

    // Forward event listeners if debug is needed for them elsewhere
    if (this.debug) {
        // Use consola for these too, tagged
        const eventLogger = consola.withTag(`Events[${this.client.options.shopName}]`);
        this.client.on('callLimits', limits => eventLogger.info('Call limits:', limits));
        this.client.on('callGraphqlLimits', limits => eventLogger.info('GraphQL limits:', limits));
    }
  }

  /**
   * Executes a GraphQL query or mutation with debug logging.
   * @param {string} queryOrMutation - The GraphQL query or mutation string.
   * @param {object} [variables] - Optional variables for the query or mutation.
   * @param {string} [operationName] - Optional name for the operation for logging context.
   * @returns {Promise<object>} - The result from the Shopify API.
   */
  async graphql(queryOrMutation, variables = undefined, operationName = 'GraphQL Operation') {
    const logger = consola.withTag(`GraphQL[${this.client.options.shopName} ${operationName}]`);

    if (this.debug) {
        logger.info(queryOrMutation);
        logger.info(JSON.stringify(variables, null, 2));
    }

    const result = await this.client.graphql(queryOrMutation, variables);
    if (this.debug) {
      logger.info('Response:', result);
    }
    return result;
  }

  // Add wrappers for other shopify-api-node methods if needed (e.g., rest calls)
  // on(...args) {
  //   this.client.on(...args);
  // }
}

module.exports = ShopifyClientWrapper;
