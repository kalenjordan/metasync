const logger = require("./logger");
const path = require('path');
const fs = require('fs');
const os = require('os');
const yaml = require('js-yaml');

/**
 * Get shop configuration from ~/metasync.yaml file by shop name
 *
 * @param {string} shopName - Shop name to lookup
 * @returns {Object|null} Object with domain and accessToken, or null if not found
 */
function getShopConfig(shopName) {
  if (!shopName) return null;

  try {
    const shopsFile = path.resolve(os.homedir(), 'metasync.yaml');
    if (!fs.existsSync(shopsFile)) return null;

    const shopsConfig = yaml.load(fs.readFileSync(shopsFile, 'utf8'));

    // Find the shop by name
    const shopConfig = shopsConfig.find(s => s.name === shopName) || null;

    if (shopConfig) {
      // If protected property is not present, default to true (protected)
      if (shopConfig.protected === undefined) {
        shopConfig.protected = true;
      }
    }

    return shopConfig;
  } catch (error) {
    logger.error('Error reading ~/metasync.yaml:', error.message);
    return null;
  }
}

/**
 * Get all available shop names from ~/metasync.yaml file
 *
 * @returns {Object} Object with filePath and shopNames array
 */
function getAllShopNames() {
  const shopsFile = path.resolve(os.homedir(), 'metasync.yaml');

  const result = {
    filePath: shopsFile,
    shopNames: []
  };

  try {
    if (!fs.existsSync(shopsFile)) {
      return result;
    }

    const shopsConfig = yaml.load(fs.readFileSync(shopsFile, 'utf8'));

    // Extract shop names from the config
    result.shopNames = shopsConfig
      .filter(shop => shop.name) // Only include shops with names
      .map(shop => shop.name);

    return result;
  } catch (error) {
    logger.error('Error reading ~/metasync.yaml:', error.message);
    return result;
  }
}

module.exports = {
  getShopConfig,
  getAllShopNames
};
