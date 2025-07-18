const Shopify = require('shopify-api-node');
const chalk = require('chalk');
const logger = require('./Logger');

class ShopifyClient {
  /**
   * Wraps a shopify-api-node client instance to provide centralized debugging and error handling.
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
    this.shopName = this.client.options.shopName;

    // Set up rate limit tracking
    this.rateLimits = {
      restRemaining: null,
      restTotal: null,
      graphqlRemaining: null,
      graphqlTotal: null,
      lastUpdated: null
    };

    // Forward event listeners if debug is needed for them elsewhere
    if (this.debug) {
      // Use logger for these events
      this.client.on('callLimits', limits => {
        this.rateLimits.restRemaining = limits.remaining;
        this.rateLimits.restTotal = limits.current;
        this.rateLimits.lastUpdated = new Date();
        logger.info(`REST Call limits for [${this.shopName}]: ${JSON.stringify(limits)}`);
      });

      this.client.on('callGraphqlLimits', limits => {
        this.rateLimits.graphqlRemaining = limits.remaining;
        this.rateLimits.graphqlTotal = limits.current;
        this.rateLimits.lastUpdated = new Date();
        logger.info(`GraphQL limits for [${this.shopName}]: ${JSON.stringify(limits)}`);
      });
    }
  }

  /**
   * Executes a GraphQL query or mutation with debug logging and enhanced error handling.
   * @param {string} queryOrMutation - The GraphQL query or mutation string.
   * @param {object} [variables] - Optional variables for the query or mutation.
   * @param {string} [operationName] - Optional name for the operation for logging context.
   * @returns {Promise<object>} - The result from the Shopify API.
   * @throws {Error} - Enhanced error with operation context
   */
  async graphql(queryOrMutation, variables = undefined, operationName = 'GraphQL Operation') {
    this.operationCounter++;
    const operationId = `${this.shopName}-${operationName}-${this.operationCounter}`;
    const logPrefix = `GraphQL[${this.shopName} ${operationName}]`;

    try {
      // Debug logging for the request
      if (this.debug) {
        logger.info(`${logPrefix}: Starting operation: ${chalk.bold(operationId)}`);
        logger.debug(queryOrMutation);
        logger.debug(JSON.stringify(variables, null, 2));
      }

      // Execute the GraphQL request
      const result = await this.client.graphql(queryOrMutation, variables);

      // Debug logging for the response
      if (this.debug) {
        logger.info(`${logPrefix}: Operation ${chalk.bold(operationId)} completed successfully`);
        logger.debug(`Response: ${JSON.stringify(result, null, 2)}`);
      }

      // Check for GraphQL errors in the response
      if (result.errors) {
        const errorMessages = result.errors.map(e => e.message).join(', ');
        const errorDetails = {
          operationName,
          operationId,
          errors: result.errors,
          variables
        };

        logger.error(`${logPrefix}: GraphQL errors in operation ${operationId}: ${errorMessages}`);
        if (this.debug) {
          logger.error(`Error details: ${JSON.stringify(errorDetails, null, 2)}`);
        }

        // We still return the result so caller can handle these errors
        // as some operations might continue with partial data
        return result;
      }

      // Return the successful result
      return result;

    } catch (error) {
      // Handle network errors and other exceptions
      // Format a detailed error with context about the operation
      const enhancedError = new Error(`Shopify GraphQL error in operation ${operationId} (${operationName}): ${error.message}`);
      enhancedError.originalError = error;
      enhancedError.operationName = operationName;
      enhancedError.operationId = operationId;
      enhancedError.shopName = this.shopName;

      // Only include variables in debug mode to avoid leaking sensitive data in production logs
      if (this.debug) {
        enhancedError.variables = variables;
        enhancedError.query = queryOrMutation;
      }

      // Check if this is a rate limit error
      if (error.message && error.message.includes('Throttled')) {
        logger.warn(`${logPrefix}: Rate limit exceeded for shop ${this.shopName}. Consider implementing backoff strategy.`);
        enhancedError.isRateLimit = true;
      }

      // Log the error
      logger.error(`${logPrefix}: GraphQL operation ${chalk.bold(operationId)} failed: ${error.message}`);

      if (this.debug) {
        logger.debug(`Error stack: ${error.stack}`);

        // Log rate limit information if available
        if (this.rateLimits.lastUpdated) {
          logger.info(`Current rate limits: graphql: ${this.rateLimits.graphqlRemaining}/${this.rateLimits.graphqlTotal}, ` +
                     `rest: ${this.rateLimits.restRemaining}/${this.rateLimits.restTotal}, ` +
                     `lastUpdated: ${this.rateLimits.lastUpdated}`);
        }
      }

      throw enhancedError;
    }
  }

  /**
   * Makes a REST API call with consistent error handling
   * @param {string} resource - The Shopify resource (e.g., 'products', 'orders')
   * @param {string} method - The HTTP method (get, post, put, delete)
   * @param {object} [params] - Optional params for the request
   * @returns {Promise<object>} - The API response
   */
  async rest(resource, method, params = undefined) {
    if (!this.client[resource] || typeof this.client[resource][method] !== 'function') {
      throw new Error(`Invalid resource or method: ${resource}.${method}`);
    }

    const operationId = `${this.shopName}-REST-${resource}-${method}-${++this.operationCounter}`;
    const logPrefix = `REST[${this.shopName} ${resource}.${method}]`;

    try {
      // Debug logging for the request
      if (this.debug) {
        logger.info(`${logPrefix}: Starting REST operation: ${chalk.bold(operationId)}`);
        if (params) {
          logger.debug(`Params: ${JSON.stringify(params, null, 2)}`);
        }
      }

      // Execute the REST request
      const result = await this.client[resource][method](params);

      // Debug logging for the response
      if (this.debug) {
        logger.info(`${logPrefix}: REST operation ${chalk.bold(operationId)} completed successfully`);
        logger.debug(`Response: ${JSON.stringify(result, null, 2)}`);
      }

      return result;

    } catch (error) {
      // Create enhanced error with context
      const enhancedError = new Error(`Shopify REST error in operation ${operationId} (${resource}.${method}): ${error.message}`);
      enhancedError.originalError = error;
      enhancedError.resource = resource;
      enhancedError.method = method;
      enhancedError.operationId = operationId;
      enhancedError.shopName = this.shopName;

      if (this.debug) {
        enhancedError.params = params;
      }

      // Check for rate limiting
      if (error.statusCode === 429) {
        logger.warn(`${logPrefix}: REST rate limit exceeded for shop ${this.shopName}. Consider implementing backoff strategy.`);
        enhancedError.isRateLimit = true;
      }

      // Log error with appropriate context
      logger.error(`${logPrefix}: REST operation ${chalk.bold(operationId)} failed: ${error.message}`);

      if (this.debug) {
        logger.debug(`Error stack: ${error.stack}`);

        // Log HTTP details if available
        if (error.statusCode) {
          logger.error(`HTTP Status: ${error.statusCode}`);
        }

        // Log rate limit information if available
        if (this.rateLimits.lastUpdated) {
          logger.info(`Current rate limits: graphql: ${this.rateLimits.graphqlRemaining}/${this.rateLimits.graphqlTotal}, ` +
                     `rest: ${this.rateLimits.restRemaining}/${this.rateLimits.restTotal}, ` +
                     `lastUpdated: ${this.rateLimits.lastUpdated}`);
        }
      }

      throw enhancedError;
    }
  }

  /**
   * Get information about current rate limits
   * @returns {object} Current rate limit information
   */
  getRateLimits() {
    return {
      ...this.rateLimits,
      shop: this.shopName,
      isNearingLimit: this.isNearingRateLimit()
    };
  }

  /**
   * Check if we're approaching rate limits
   * @param {number} threshold - Percentage threshold to consider "nearing limit" (default: 80%)
   * @returns {boolean} Whether we're nearing the rate limit
   */
  isNearingRateLimit(threshold = 80) {
    if (!this.rateLimits.lastUpdated) return false;

    // Check if we're below the threshold percentage of our total limit
    const graphqlPercentUsed = this.rateLimits.graphqlRemaining ?
      100 - (this.rateLimits.graphqlRemaining / this.rateLimits.graphqlTotal * 100) : 0;

    const restPercentUsed = this.rateLimits.restRemaining ?
      100 - (this.rateLimits.restRemaining / this.rateLimits.restTotal * 100) : 0;

    return graphqlPercentUsed > threshold || restPercentUsed > threshold;
  }
}

module.exports = ShopifyClient;
