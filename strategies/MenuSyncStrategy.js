const logger = require("../utils/Logger");
const {
  MenuFetchAll,
  MenuCreate,
  MenuUpdate
} = require('../graphql');

class MenuSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.debug = options.debug;
  }

  async fetchMenus(client) {
    try {
      const menus = [];
      let hasNextPage = true;
      let cursor = null;

      while (hasNextPage) {
        const variables = {
          first: 250,
          after: cursor
        };

        const result = await client.graphql(MenuFetchAll, variables, 'FetchMenus');

        if (result.menus.edges) {
          result.menus.edges.forEach(edge => {
            menus.push(edge.node);
          });
        }

        hasNextPage = result.menus.pageInfo.hasNextPage;
        cursor = result.menus.pageInfo.endCursor;
      }

      return menus;
    } catch (error) {
      logger.error(`Error fetching menus: ${error.message}`);
      return [];
    }
  }

  async createMenu(client, menu) {
    const input = {
      title: menu.title,
      handle: menu.handle,
      items: this.processMenuItems(menu.items)
    };

    if (this.options.notADrill) {
      try {
        const result = await client.graphql(MenuCreate, { input }, 'CreateMenu');
        if (result.menuCreate.userErrors.length > 0) {
          logger.error(`Failed to create menu "${menu.title}":`, result.menuCreate.userErrors);
          return null;
        }
        return result.menuCreate.menu;
      } catch (error) {
        logger.error(`Error creating menu "${menu.title}": ${error.message}`);
        return null;
      }
    } else {
      logger.info(`[DRY RUN] Would create menu "${menu.title}"`);
      return { id: "dry-run-id", title: menu.title, handle: menu.handle };
    }
  }

  async updateMenu(client, menu, existingMenu) {
    const input = {
      title: menu.title,
      handle: menu.handle,
      items: this.processMenuItems(menu.items)
    };

    if (this.options.notADrill) {
      try {
        const result = await client.graphql(MenuUpdate, { id: existingMenu.id, input }, 'UpdateMenu');
        if (result.menuUpdate.userErrors.length > 0) {
          logger.error(`Failed to update menu "${menu.title}":`, result.menuUpdate.userErrors);
          return null;
        }
        return result.menuUpdate.menu;
      } catch (error) {
        logger.error(`Error updating menu "${menu.title}": ${error.message}`);
        return null;
      }
    } else {
      logger.info(`[DRY RUN] Would update menu "${menu.title}"`);
      return { id: existingMenu.id, title: menu.title, handle: menu.handle };
    }
  }

  processMenuItems(items) {
    if (!items || items.length === 0) {
      return [];
    }

    return items.map(item => {
      const processedItem = {
        title: item.title,
        type: item.type,
        url: item.url,
        resourceId: item.resourceId,
        tags: item.tags || []
      };

      // Process nested items if they exist
      if (item.items && item.items.length > 0) {
        processedItem.items = this.processMenuItems(item.items);
      }

      return processedItem;
    });
  }

  // --- Sync Orchestration Methods ---

  async sync() {
    logger.info(`Syncing menus...`);

    // Fetch menus from source and target shops
    const sourceMenus = await this.fetchMenus(this.sourceClient);
    logger.info(`Found ${sourceMenus.length} menu(s) in source shop`);

    const targetMenus = await this.fetchMenus(this.targetClient);
    logger.info(`Found ${targetMenus.length} menu(s) in target shop`);

    // Create map of target menus by handle for easy lookup
    const targetMenuMap = targetMenus.reduce((map, menu) => {
      if (menu.handle) {
        map[menu.handle] = menu;
      }
      return map;
    }, {});

    const results = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let processedCount = 0;

    // Process each source menu
    for (const menu of sourceMenus) {
      if (processedCount >= this.options.limit) {
        logger.info(`Reached processing limit (${this.options.limit}). Stopping menu sync.`);
        break;
      }

      if (menu.handle && targetMenuMap[menu.handle]) {
        // Update existing menu
        logger.info(`Updating menu: ${menu.title}`);
        const updated = await this.updateMenu(this.targetClient, menu, targetMenuMap[menu.handle]);
        updated ? results.updated++ : results.failed++;
      } else {
        // Create new menu
        logger.info(`Creating menu: ${menu.title}`);
        const created = await this.createMenu(this.targetClient, menu);
        created ? results.created++ : results.failed++;
      }

      processedCount++;
    }

    logger.success(`Finished syncing menus.`);
    return { definitionResults: results, dataResults: null };
  }
}

module.exports = MenuSyncStrategy;
