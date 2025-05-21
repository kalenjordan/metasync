const logger = require('../logger');

class CollectionPublicationHandler {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.targetChannels = null;
    this.targetPublications = null;
  }

  async fetchTargetPublicationData() {
    logger.startSection('Fetching target store publication data');

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

    try {
      const response = await this.targetClient.graphql(getPublicationsQuery, {}, 'GetPublicationsAndChannels');
      this.targetChannels = response.channels.edges.map(edge => edge.node);
      this.targetPublications = response.publications.edges.map(edge => edge.node);

      logger.info(`Found ${this.targetChannels.length} channels and ${this.targetPublications.length} publications in target store`);

      if (this.options.debug && this.targetChannels.length > 0) {
        logger.debug(`Available channels: ${this.targetChannels.map(c => c.handle).join(', ')}`);
      }
    } catch (error) {
      logger.error(`Error fetching publication data: ${error.message}`);
      this.targetChannels = [];
      this.targetPublications = [];
    }

    logger.endSection();
  }

  async syncCollectionPublications(collectionId, sourcePublications) {
    if (!sourcePublications || !this.targetChannels || !this.targetPublications) {
      return true; // Skip if no publication data available
    }

    // Extract publication data from collection
    let publicationsArray = [];
    if (sourcePublications.edges && Array.isArray(sourcePublications.edges)) {
      publicationsArray = sourcePublications.edges.map(edge => edge.node);
    }

    if (publicationsArray.length === 0) {
      logger.info(`No publication channels to sync for this collection`);
      return true;
    }

    // Filter out invalid publications (those without a valid channel.handle)
    const validPublications = publicationsArray.filter(pub =>
      pub && pub.channel && typeof pub.channel.handle === 'string' && pub.channel.handle.length > 0
    );

    if (validPublications.length === 0) {
      logger.info(`No valid publication channels found after filtering`);
      return true;
    }

    logger.startSection(`Syncing collection publication to ${validPublications.length} channels`);

    // Get current publications for this collection
    const getCollectionPublicationsQuery = `#graphql
      query GetCollectionPublications($collectionId: ID!) {
        collection(id: $collectionId) {
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
      const response = await this.targetClient.graphql(
        getCollectionPublicationsQuery,
        { collectionId },
        'GetCollectionPublications'
      );

      if (response.collection && response.collection.publications) {
        currentPublications = response.collection.publications.edges.map(edge => edge.node);
      }

      if (this.options.debug) {
        logger.debug(`Collection is currently published to ${currentPublications.length} channels`);
      }
    } catch (error) {
      logger.warn(`Unable to fetch current publications: ${error.message}`);
      // Continue anyway since we can still try to publish
    }

    // Match source publications to target channels by handle
    const publicationsToCreate = [];
    const skippedChannels = [];
    const addedPublicationIds = new Set();

    // For each source publication
    for (const sourcePublication of validPublications) {
      // Only process publications that are actually published
      if (!sourcePublication.isPublished) continue;

      const sourceChannelHandle = sourcePublication.channel.handle;

      // Find matching target channel
      const targetChannel = this.targetChannels.find(channel => channel.handle === sourceChannelHandle);
      if (targetChannel) {
        // Find the publication associated with this channel - use first publication as default
        const targetPublication = this.targetPublications.length > 0 ? this.targetPublications[0] : null;

        if (targetPublication) {
          // Check if collection is already published to this channel
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
          } else if (this.options.debug) {
            if (alreadyPublished) {
              logger.debug(`Collection already published to ${sourceChannelHandle}`);
            } else {
              logger.debug(`Skipping duplicate publication ID for channel ${sourceChannelHandle}`);
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

    // Log skipped channels
    if (skippedChannels.length > 0) {
      logger.warn(`Skipping ${skippedChannels.length} channels that don't exist in target store: ${skippedChannels.join(', ')}`);
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
        logger.info(`Publishing collection to ${publicationsToCreate.length} channels`);

        const input = publicationsToCreate.map(pub => ({
          publicationId: pub.publicationId,
          publishDate: new Date().toISOString()
        }));

        const result = await this.targetClient.graphql(publishMutation, {
          id: collectionId,
          input
        }, 'PublishablePublish');

        if (result.publishablePublish.userErrors.length > 0) {
          logger.error(`Failed to publish collection:`, result.publishablePublish.userErrors);
          logger.endSection();
          return false;
        }

        logger.success(`Successfully published collection to ${publicationsToCreate.length} channels`);
        logger.endSection();
        return true;
      } catch (error) {
        logger.error(`Error publishing collection: ${error.message}`);
        logger.endSection();
        return false;
      }
    } else {
      logger.info(`[DRY RUN] Would publish collection to ${publicationsToCreate.length} channels: ${publicationsToCreate.map(p => p.channelHandle).join(', ')}`);
      logger.endSection();
      return true;
    }
  }
}

module.exports = CollectionPublicationHandler;
