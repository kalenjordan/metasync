/**
 * Fake Product Generator
 *
 * Utility for generating fake products for testing purposes
 * using the Faker.js library
 */

const { faker } = require('@faker-js/faker');
const consola = require('consola');
const LoggingUtils = require('./LoggingUtils');

class FakeProductGenerator {
  constructor(client, options = {}) {
    this.client = client;
    this.options = options;
    this.debug = options.debug;
  }

  /**
   * Generate a single fake product
   * @param {Object} options - Options for product generation
   * @returns {Object} - Fake product object
   */
  generateProduct(options = {}) {
    const productType = options.productType || faker.commerce.department();
    const title = options.title || faker.commerce.productName();
    const handle = options.handle || faker.helpers.slugify(title).toLowerCase();

    // Generate product description with potential HTML formatting
    const description = faker.commerce.productDescription();
    const descriptionHtml = `<p>${description}</p><ul>
      <li>${faker.commerce.productAdjective()} quality</li>
      <li>Made with ${faker.commerce.productMaterial()}</li>
      <li>Designed for ${faker.commerce.productAdjective()} use</li>
    </ul>`;

    // Generate price with potential discount
    const basePrice = parseFloat(faker.commerce.price({ min: 10, max: 100 }));
    const hasDiscount = Math.random() > 0.7;
    const compareAtPrice = hasDiscount ? basePrice * 1.2 : null;

    return {
      title,
      handle,
      description,
      descriptionHtml,
      vendor: faker.company.name(),
      productType,
      status: 'ACTIVE',
      tags: [
        productType,
        faker.commerce.productMaterial(),
        faker.commerce.productAdjective()
      ],
      options: this._generateOptions(),
      variants: this._generateVariants(options),
      metafields: this._generateMetafields(),
      images: this._generateImages()
    };
  }

  /**
   * Generate multiple fake products
   * @param {number} count - Number of products to generate
   * @param {Object} options - Options for product generation
   * @returns {Array} - Array of fake product objects
   */
  generateProducts(count = 1, options = {}) {
    const products = [];

    for (let i = 0; i < count; i++) {
      products.push(this.generateProduct(options));
    }

    return products;
  }

  /**
   * Generate product options (like Size, Color)
   * @returns {Array} - Array of product options
   * @private
   */
  _generateOptions() {
    // Randomize which options to include
    const includeSizes = Math.random() > 0.3;
    const includeColors = Math.random() > 0.3;
    const includeMaterials = Math.random() > 0.7;

    const options = [];

    if (includeSizes) {
      options.push({
        name: "Size",
        values: ["Small", "Medium", "Large"]
      });
    }

    if (includeColors) {
      options.push({
        name: "Color",
        values: [
          faker.color.human(),
          faker.color.human(),
          faker.color.human()
        ].filter((value, index, self) => self.indexOf(value) === index) // Ensure unique colors
      });

      // Ensure we have at least 2 unique color values
      const colorValues = options[options.length - 1].values;
      while (colorValues.length < 2) {
        const newColor = faker.color.human();
        if (!colorValues.includes(newColor)) {
          colorValues.push(newColor);
        }
      }
    }

    if (includeMaterials) {
      options.push({
        name: "Material",
        values: [
          faker.commerce.productMaterial(),
          faker.commerce.productMaterial()
        ].filter((value, index, self) => self.indexOf(value) === index) // Ensure unique materials
      });

      // Ensure we have at least 2 unique material values
      const materialValues = options[options.length - 1].values;
      while (materialValues.length < 2) {
        const newMaterial = faker.commerce.productMaterial();
        if (!materialValues.includes(newMaterial)) {
          materialValues.push(newMaterial);
        }
      }
    }

    // Ensure we have at least one option for variant generation
    if (options.length === 0) {
      options.push({
        name: "Style",
        values: ["Standard", "Deluxe", "Premium"]
      });
    }

    return options;
  }

  /**
   * Generate product variants based on options
   * @param {Object} options - Options for variant generation
   * @returns {Array} - Array of product variants
   * @private
   */
  _generateVariants(options = {}) {
    const productOptions = this._generateOptions();
    if (productOptions.length === 0) return [];

    // Generate all possible combinations of options
    const variantCombinations = this._generateVariantCombinations(productOptions);
    const variants = [];

    for (const combo of variantCombinations) {
      const basePrice = parseFloat(faker.commerce.price({ min: 10, max: 100, dec: 2 }));
      const hasDiscount = Math.random() > 0.7;

      const variant = {
        title: combo.map(opt => opt.value).join(' / '),
        sku: faker.string.alphanumeric(8).toUpperCase(),
        price: basePrice.toFixed(2),
        compareAtPrice: hasDiscount ? (basePrice * 1.2).toFixed(2) : null,
        inventoryQuantity: faker.number.int({ min: 0, max: 100 }),
        inventoryPolicy: 'DENY',
        taxable: true,
        barcode: faker.string.numeric(12),
        selectedOptions: combo,
        weight: faker.number.float({ min: 0.1, max: 5.0, precision: 0.1 }),
        weightUnit: 'KILOGRAMS'
      };

      variants.push(variant);
    }

    return variants;
  }

  /**
   * Generate all possible combinations of product options
   * @param {Array} options - Product options
   * @returns {Array} - Array of option combinations
   * @private
   */
  _generateVariantCombinations(options) {
    const results = [];

    function generateCombos(optionIndex, currentCombo) {
      if (optionIndex === options.length) {
        results.push([...currentCombo]);
        return;
      }

      const currentOption = options[optionIndex];
      const optionName = currentOption.name;

      for (const value of currentOption.values) {
        currentCombo.push({ name: optionName, value });
        generateCombos(optionIndex + 1, currentCombo);
        currentCombo.pop();
      }
    }

    generateCombos(0, []);
    return results;
  }

  /**
   * Generate metafields for the product
   * @returns {Array} - Array of metafields
   * @private
   */
  _generateMetafields() {
    const metafields = [];

    // Add some standard metafields
    metafields.push({
      namespace: "custom",
      key: "origin_country",
      value: faker.location.country(),
      type: "single_line_text_field"
    });

    metafields.push({
      namespace: "custom",
      key: "manufacturer",
      value: faker.company.name(),
      type: "single_line_text_field"
    });

    // Randomly add additional metafields
    if (Math.random() > 0.5) {
      metafields.push({
        namespace: "specs",
        key: "material",
        value: faker.commerce.productMaterial(),
        type: "single_line_text_field"
      });
    }

    if (Math.random() > 0.7) {
      metafields.push({
        namespace: "specs",
        key: "dimensions",
        value: `${faker.number.int({ min: 10, max: 100 })}cm x ${faker.number.int({ min: 10, max: 100 })}cm x ${faker.number.int({ min: 5, max: 30 })}cm`,
        type: "single_line_text_field"
      });
    }

    if (Math.random() > 0.6) {
      metafields.push({
        namespace: "shipping",
        key: "requires_special_handling",
        value: Math.random() > 0.7 ? "true" : "false",
        type: "boolean"
      });
    }

    return metafields;
  }

  /**
   * Generate fake product images
   * @returns {Array} - Array of image objects
   * @private
   */
  _generateImages() {
    const images = [];
    const imageCount = faker.number.int({ min: 1, max: 4 });

    // Use Faker's image generator for placeholder images
    for (let i = 0; i < imageCount; i++) {
      const width = 800;
      const height = 600;
      const imageUrl = faker.image.url({ width, height, category: 'product' });

      images.push({
        src: imageUrl,
        altText: `Product image ${i+1} for ${faker.commerce.productName()}`,
        width,
        height
      });
    }

    return images;
  }

  /**
   * Create the fake products in Shopify
   * @param {Array} products - Products to create
   * @returns {Promise<Object>} - Results of product creation
   */
  async createProducts(products) {
    const results = {
      created: 0,
      failed: 0,
      products: []
    };

    // If no client is provided, cannot create products
    if (!this.client) {
      LoggingUtils.error("Cannot create products: No Shopify client provided", 1);
      return results;
    }

    if (!Array.isArray(products)) {
      products = [products];
    }

    // Check if we have a ProductSyncStrategy to use
    if (!this.productSyncStrategy) {
      const ProductSyncStrategy = require('../strategies/ProductSyncStrategy');
      this.productSyncStrategy = new ProductSyncStrategy(this.client, this.client, this.options);
    }

    for (const product of products) {
      try {
        LoggingUtils.info(`Creating fake product: ${product.title}`, 1, 'main');

        const createdProduct = await this.productSyncStrategy.createProduct(this.client, product);

        if (createdProduct) {
          results.created++;
          results.products.push(createdProduct);
        } else {
          results.failed++;
        }
      } catch (error) {
        LoggingUtils.error(`Error creating fake product "${product.title}": ${error.message}`, 2);
        results.failed++;
      }
    }

    return results;
  }
}

module.exports = FakeProductGenerator;
