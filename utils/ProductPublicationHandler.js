const logger = require("./logger");
/**
 * Product Publication Handler
 *
 * Handles product publication operations for Shopify products, including:
 * - Fetching available channels and publications
 * - Checking current publication status
 * - Publishing products to channels
 * - Managing publication errors
 */

class ProductPublicationHandler {
  constructor(client, options = {}) {
    this.client = client;
    this.options = options;
    this.debug = options.debug;
  }

  /**
   * Synchronize product publications
   * @param {string} productId - The product ID
   * @param {Array} sourcePublications - Array of publication objects from source product
   * @param {string} logPrefix - Prefix for logs
   * @returns {Promise<boolean>} - Success status
   */
  async syncProductPublications(productId, sourcePublications, logPrefix = '') {
    if (!sourcePublications || sourcePublications.length === 0) {
      logger.info(`No publication channels to sync`);
      return true;
    }

    // Filter out invalid publications (those without a valid channel.handle)
    const validPublications = sourcePublications.filter(pub =>
      pub && pub.channel && typeof pub.channel.handle === 'string' && pub.channel.handle.length > 0
    );

    // Log skipped publications only in debug mode
    if (validPublications.length < sourcePublications.length && this.debug) {
      logger.debug(`${logPrefix}- Filtered out ${sourcePublications.length - validPublications.length} invalid publications without valid channel handles`);

      // Debug the problematic publications
      const invalidPublications = sourcePublications.filter(pub =>
        !pub || !pub.channel || typeof pub.channel.handle !== 'string' || pub.channel.handle.length === 0
      );

      logger.debug(`${logPrefix}- Invalid publication details:`,
        invalidPublications.map(pub => ({
          isPublished: pub.isPublished || false,
          hasChannel: !!pub.channel,
          channelId: pub.channel?.id || 'missing',
          channelHandle: pub.channel?.handle || 'missing',
          publishDate: pub.publishDate || 'unknown'
        }))
      );
    }

    // Use only valid publications
    const publicationsToProcess = validPublications;

    if (publicationsToProcess.length === 0) {
      logger.info(`No valid publication channels to sync after filtering`);
      return true;
    }

    // Log detailed information about the publications we'll process
    if (this.debug) {
      logger.debug(`${logPrefix}- Valid publications to process:`,
        publicationsToProcess.map(pub => ({
          channelHandle: pub.channel.handle,
          channelName: pub.channel.name || 'unknown',
          isPublished: pub.isPublished
        }))
      );
    }

    logger.startSection(`Syncing product publication to ${publicationsToProcess.length} channels`);

    // First, get available channels and publications in the target store
    const getPublicationsQuery = `#graphql
      query GetPublicationsAndChannels {
        publications(first: 25) {
          edges {
            node {
              id
              name
              app {
                id
              }
            }
          }
        }
        channels(first: 25) {
          edges {
            node {
              id
              name
              handle
            }
          }
        }
      }
    `;

    let targetChannels = [];
    let targetPublications = [];
    try {
      const response = await this.client.graphql(getPublicationsQuery, {}, 'GetPublicationsAndChannels');
      targetChannels = response.channels.edges.map(edge => edge.node);
      targetPublications = response.publications.edges.map(edge => edge.node);

      if (this.debug) {
        logger.debug(`${logPrefix}  - Found ${targetChannels.length} available channels in target store`);
        logger.debug(`${logPrefix}  - Found ${targetPublications.length} publications in target store`);
        if (targetChannels.length > 0) {
          logger.debug(`${logPrefix}  - Available channels: ${targetChannels.map(c => c.handle).join(', ')}`);
        }
      }
    } catch (error) {
      logger.error(`Error fetching target store publications: ${error.message}`);
      logger.endSection();
      return false;
    }

    // Get current publication status for this product
    const getProductPublicationsQuery = `#graphql
      query GetProductPublications($productId: ID!) {
        product(id: $productId) {
          publications(first: 25) {
            edges {
              node {
                channel {
                  id
                  handle
                }
                isPublished
              }
            }
          }
        }
      }
    `;

    let currentPublications = [];
    try {
      const response = await this.client.graphql(getProductPublicationsQuery, { productId }, 'GetProductPublications');
      if (response.product && response.product.publications) {
        currentPublications = response.product.publications.edges.map(edge => edge.node);
      }

      if (this.debug) {
        logger.debug(`${logPrefix}  - Product is currently published to ${currentPublications.length} channels`);
        if (currentPublications.length > 0) {
          logger.debug(`${logPrefix}  - Currently published to: ${currentPublications.filter(p => p.isPublished).map(p => p.channel.handle).join(', ')}`);
        }
      }
    } catch (error) {
      logger.warn(`Unable to fetch current publications: ${error.message}`);
      // Continue anyway since we can still try to publish
    }

    // Match source publications to target channels by handle
    const publicationsToCreate = [];
    const skippedChannels = [];
    // Set to track publication IDs we've already added to avoid duplicates
    const addedPublicationIds = new Set();

    // For each source publication
    for (const sourcePublication of publicationsToProcess) {
      // Only process publications that are actually published
      if (!sourcePublication.isPublished) continue;

      const sourceChannelHandle = sourcePublication.channel.handle;

      // Find matching target channel
      const targetChannel = targetChannels.find(channel => channel.handle === sourceChannelHandle);
      if (targetChannel) {
        // Find the publication associated with this channel
        // For now, use the first publication as a default if we don't have more info
        // In most cases, there will only be a single publication (the default one)
        const targetPublication = targetPublications.length > 0 ? targetPublications[0] : null;

        if (targetPublication) {
          // Check if product is already published to this channel
          const alreadyPublished = currentPublications.some(pub =>
            pub.channel.handle === sourceChannelHandle && pub.isPublished
          );

          // Check if we've already added this publication ID
          if (!alreadyPublished && !addedPublicationIds.has(targetPublication.id)) {
            publicationsToCreate.push({
              publicationId: targetPublication.id,
              channelHandle: sourceChannelHandle
            });
            // Mark this publication ID as added to avoid duplicates
            addedPublicationIds.add(targetPublication.id);
          } else if (this.debug) {
            if (alreadyPublished) {
              logger.debug(`${logPrefix}  - Product already published to ${sourceChannelHandle}`);
            } else {
              logger.debug(`${logPrefix}  - Skipping duplicate publication ID for channel ${sourceChannelHandle}`);
            }
          }
        } else {
          logger.warn(`Found channel ${sourceChannelHandle} but no associated publication in target store`);
          skippedChannels.push(sourceChannelHandle);
        }
      } else {
        skippedChannels.push(sourceChannelHandle);
      }
    }

    // Log skipped channels only when there are any and only as a debug message if not important
    if (skippedChannels.length > 0) {
      if (this.debug) {
        logger.debug(`${logPrefix}  - Skipping ${skippedChannels.length} channels that don't exist in target store: ${skippedChannels.join(', ')}`);
      } else if (skippedChannels.length > 1 || skippedChannels[0] !== 'online_store') {
        // Only warn about non-standard channels being skipped
        logger.warn(`Skipping ${skippedChannels.length} channels that don't exist in target store: ${skippedChannels.join(', ')}`);
      }
    }

    // If no publications to create, we're done
    if (publicationsToCreate.length === 0) {
      logger.info(`No new publication channels to add`);
      logger.endSection();
      return true;
    }

    // Publish to target channels
    const publishMutation = `#graphql
      mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors {
            field
            message
          }
        }
      }
    `;

    if (this.options.notADrill) {
      try {
        logger.info(`Publishing product to ${publicationsToCreate.length} channels`);

        const input = publicationsToCreate.map(pub => ({
          publicationId: pub.publicationId,
          // Use current date for publish date
          publishDate: new Date().toISOString()
        }));

        const result = await this.client.graphql(publishMutation, {
          id: productId,
          input
        }, 'PublishablePublish');

        if (result.publishablePublish.userErrors.length > 0) {
          logger.error(`Failed to publish product:`, result.publishablePublish.userErrors);
          logger.endSection();
          return false;
        }

        logger.success(`Successfully published product to ${publicationsToCreate.length} channels`);

        // End publish section before returning
        logger.endSection();
        return true;
      } catch (error) {
        logger.error(`Error publishing product: ${error.message}`);
        logger.endSection();
        return false;
      }
    } else {
      logger.info(`[DRY RUN] Would publish product to ${publicationsToCreate.length} channels: ${publicationsToCreate.map(p => p.channelHandle).join(', ')}`);

      // End publish section before returning
      logger.endSection();
      return true;
    }
  }
}

module.exports = ProductPublicationHandler;
