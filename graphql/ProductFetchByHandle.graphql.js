const logger = require("../utils/Logger");
/**
 * GraphQL query to fetch a product by its handle with all details
 */
module.exports = `#graphql
  query GetProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      title
      handle
      description
      descriptionHtml
      vendor
      productType
      status
      tags
      options {
        name
        values
      }
      publications(first: 20) {
        edges {
          node {
            channel {
              id
              name
              handle
            }
            publishDate
            isPublished
          }
        }
      }
      images(first: 10) {
        edges {
          node {
            id
            src
            altText
            width
            height
          }
        }
      }
      variants(first: 100) {
        edges {
          node {
            id
            title
            sku
            price
            compareAtPrice
            inventoryQuantity
            inventoryPolicy
            inventoryItem {
              id
              tracked
              requiresShipping
              measurement {
                weight {
                  value
                  unit
                }
              }
            }
            taxable
            barcode
            selectedOptions {
              name
              value
            }
            image {
              id
              src
              altText
              width
              height
            }
            metafields(first: 50) {
              edges {
                node {
                  id
                  namespace
                  key
                  value
                  type
                }
              }
            }
          }
        }
      }
      metafields(first: 100) {
        edges {
          node {
            id
            namespace
            key
            value
            type
          }
        }
      }
    }
  }
`;
