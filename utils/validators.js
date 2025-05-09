/**
 * Checks if a shop name is a production shop
 * @param {string} shopName - The shop name to check
 * @returns {boolean} - true if it's a production shop, false otherwise
 */
function isProductionShop(shopName) {
  if (!shopName) return false;

  const lowerName = shopName.toLowerCase();
  return lowerName.includes('production') || lowerName.includes('prod');
}

module.exports = {
  isProductionShop
};
