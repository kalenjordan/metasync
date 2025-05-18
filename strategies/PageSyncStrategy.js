const logger = require("../utils/logger");
;
const {
  PageFetchAll,
  PageCreate,
  PageUpdate
} = require('../graphql');

class PageSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.debug = options.debug;
  }

  // --- Page Methods ---

  async fetchPages(client) {
    try {
      const response = await client.graphql(PageFetchAll, { first: 100 }, 'GetPages');
      return response.pages.edges.map(edge => edge.node);
    } catch (error) {
      logger.error(`Error fetching pages: ${error.message}`);
      return [];
    }
  }

  async createPage(client, page) {
    const input = {
      title: page.title,
      body: page.body,
      handle: page.handle,
      templateSuffix: page.templateSuffix
    };

    // If page has publishedAt, mark it as published
    if (page.publishedAt) {
      input.isPublished = true;
    } else if (page.isPublished !== undefined) {
      // Use the isPublished flag if publishedAt is not available
      input.isPublished = page.isPublished;
    }

    if (this.options.notADrill) {
      try {
        const result = await client.graphql(PageCreate, { page: input }, 'CreatePage');
        if (result.pageCreate.userErrors.length > 0) {
          logger.error(`Failed to create page "${page.title}":`, result.pageCreate.userErrors);
          return null;
        }
        return result.pageCreate.page;
      } catch (error) {
        logger.error(`Error creating page "${page.title}": ${error.message}`);
        return null;
      }
    } else {
      logger.info(`[DRY RUN] Would create page "${page.title}"`);
      return { id: "dry-run-id", title: page.title, handle: page.handle };
    }
  }

  async updatePage(client, page, existingPage) {
    // Extract the ID from the GraphQL ID (format: gid://shopify/Page/123456789)
    const id = existingPage.id;

    const input = {
      title: page.title,
      body: page.body,
      handle: page.handle,
      templateSuffix: page.templateSuffix
    };

    // If page has publishedAt, mark it as published
    if (page.publishedAt) {
      input.isPublished = true;
    } else if (page.isPublished !== undefined) {
      // Use the isPublished flag if publishedAt is not available
      input.isPublished = page.isPublished;
    }

    if (this.options.notADrill) {
      try {
        const result = await client.graphql(PageUpdate, { id, page: input }, 'UpdatePage');
        if (result.pageUpdate.userErrors.length > 0) {
          logger.error(`Failed to update page "${page.title}":`, result.pageUpdate.userErrors);
          return null;
        }
        return result.pageUpdate.page;
      } catch (error) {
        logger.error(`Error updating page "${page.title}": ${error.message}`);
        return null;
      }
    } else {
      logger.info(`[DRY RUN] Would update page "${page.title}"`);
      return { id, title: page.title, handle: page.handle };
    }
  }

  // --- Sync Orchestration Methods ---

  async sync() {
    logger.info(`Syncing pages...`);

    // Fetch pages from source and target shops
    const sourcePages = await this.fetchPages(this.sourceClient);
    logger.info(`Found ${sourcePages.length} page(s) in source shop`);

    const targetPages = await this.fetchPages(this.targetClient);
    logger.info(`Found ${targetPages.length} page(s) in target shop`);

    // Create map of target pages by handle for easy lookup
    const targetPageMap = targetPages.reduce((map, page) => {
      if (page.handle) {
        map[page.handle] = page;
      }
      return map;
    }, {});

    const results = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let processedCount = 0;

    // Process each source page
    for (const page of sourcePages) {
      if (processedCount >= this.options.limit) {
        logger.info(`Reached processing limit (${this.options.limit}). Stopping page sync.`);
        break;
      }

      if (page.handle && targetPageMap[page.handle]) {
        // Update existing page
        logger.info(`Updating page: ${page.title}`);
        const updated = await this.updatePage(this.targetClient, page, targetPageMap[page.handle]);
        updated ? results.updated++ : results.failed++;
      } else {
        // Create new page
        logger.info(`Creating page: ${page.title}`);
        const created = await this.createPage(this.targetClient, page);
        created ? results.created++ : results.failed++;
      }

      processedCount++;
    }

    logger.success(`Finished syncing pages.`);
    return { definitionResults: results, dataResults: null };
  }
}

module.exports = PageSyncStrategy;
