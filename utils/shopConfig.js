const path = require('path');
const fs = require('fs');
const consola = require('consola');

/**
 * Get shop configuration from .shops.json file by shop name
 *
 * @param {string} shopName - Shop name to lookup
 * @returns {Object|null} Object with domain and accessToken, or null if not found
 */
function getShopConfig(shopName) {
  if (!shopName) return null;

  try {
    const shopsFile = path.resolve(process.cwd(), '.shops.json');
    if (!fs.existsSync(shopsFile)) return null;

    const shopsConfig = JSON.parse(fs.readFileSync(shopsFile, 'utf8'));

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
    consola.error('Error reading .shops.json:', error.message);
    return null;
  }
}

module.exports = {
  getShopConfig
};
